import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/server/db/client", () => ({
  getDb: () => testState.db,
  closeDb: vi.fn(),
}));

import { eq } from "drizzle-orm";

import { POST as createSmokeCase } from "@/app/api/operator/smoke-case/route";
import { DemoRepository } from "@/server/db/repository";
import { cases, correctionRequests, demoFaults, orders } from "@/server/db/schema";
import { createTestDb, type TestDbInstance } from "@/server/db/test-client";
import { seedDemoScenario } from "../../scripts/seed-demo";

const operatorSecret = "test-smoke-operator-secret";
const correctionToken = "test-smoke-token-which-is-long-and-url-safe-6001";

describe("append-only NG-2049 smoke case", () => {
  let database: TestDbInstance | undefined;
  let repository: DemoRepository;
  let originalCaseId: string;

  beforeEach(async () => {
    process.env.NENTRA_DEMO_OPERATOR_SECRET = operatorSecret;
    database = await createTestDb();
    testState.db = database.db;
    repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, { correctionToken });
    originalCaseId = fixture.caseId;
  });

  afterEach(async () => {
    delete process.env.NENTRA_DEMO_OPERATOR_SECRET;
    testState.db = undefined;
    await database?.close();
    database = undefined;
  });

  it("creates NG-2049 append-only with correction request and controlled fault", async () => {
    const created = await repository.createSmokeCase({
      orderNumber: "NG-2049",
      correctionToken: "test-smoke-correction-token-which-is-long-and-url-safe-01",
    });
    expect(created.created).toBe(true);
    const snapshot = await repository.getCaseSnapshot(created.caseId);
    expect(snapshot?.status).toBe("NEW");
    expect(snapshot?.order.orderNumber).toBe("NG-2049");
    expect(snapshot?.order.paymentStatus).toBe("PAID");
    const [correction] = await database!.db.select().from(correctionRequests)
      .where(eq(correctionRequests.caseId, created.caseId));
    expect(correction!.status).toBe("PENDING");
    const [fault] = await database!.db.select().from(demoFaults)
      .where(eq(demoFaults.caseId, created.caseId));
    expect(fault).toMatchObject({ tool: "quote_primary", remainingFailures: 1, errorCode: "PROVIDER_503" });
  });

  it("returns the existing fixture on duplicate creation without new rows", async () => {
    const first = await repository.createSmokeCase({
      orderNumber: "NG-2049",
      correctionToken: "test-smoke-correction-token-which-is-long-and-url-safe-02",
    });
    const ordersBefore = await database!.db.select({ id: orders.id }).from(orders);
    const second = await repository.createSmokeCase({
      orderNumber: "NG-2049",
      correctionToken: "test-smoke-correction-token-which-is-long-and-url-safe-03",
    });
    expect(second.created).toBe(false);
    expect(second.caseId).toBe(first.caseId);
    expect(await database!.db.select({ id: orders.id }).from(orders)).toHaveLength(ordersBefore.length);
  });

  it("rejects other order numbers and weak tokens", async () => {
    await expect(repository.createSmokeCase({ orderNumber: "NG-2048", correctionToken: "x".repeat(40) }))
      .rejects.toMatchObject({ code: "SMOKE_ORDER_NOT_ALLOWED" });
    await expect(repository.createSmokeCase({ orderNumber: "NG-2050", correctionToken: "x".repeat(40) }))
      .rejects.toMatchObject({ code: "SMOKE_ORDER_NOT_ALLOWED" });
    await expect(repository.createSmokeCase({ orderNumber: "NG-2049", correctionToken: "short" }))
      .rejects.toMatchObject({ code: "SMOKE_TOKEN_WEAK" });
  });

  it("lists, snapshots and starts both cases while leaving NG-2048 untouched", async () => {
    const before = await repository.getCaseSnapshot(originalCaseId);
    const created = await repository.createSmokeCase({
      orderNumber: "NG-2049",
      correctionToken: "test-smoke-correction-token-which-is-long-and-url-safe-04",
    });
    const listed = await repository.listCases();
    expect(listed.map((snapshot) => snapshot.order.orderNumber).sort()).toEqual(["NG-2048", "NG-2049"]);
    const started = await repository.startCase(created.caseId);
    expect(started.accepted).toBe(true);
    expect((await repository.getCaseSnapshot(created.caseId))?.status).toBe("TRIAGING");
    const events = await repository.listCaseEvents(created.caseId);
    expect(events.find((event) => event.type === "CASE_STARTED")?.payload.summary).toContain("NG-2049");
    const after = await repository.getCaseSnapshot(originalCaseId);
    expect(after).toMatchObject({ id: before!.id, status: before!.status, version: before!.version });
    expect(await database!.db.select().from(cases).where(eq(cases.orderId, before!.order.id))).toHaveLength(1);
  });

  it("serves creation through the authenticated operator route", async () => {
    const headers = { "content-type": "application/json", "x-nentra-operator-secret": operatorSecret };
    const unauthenticated = await createSmokeCase(new Request(
      "http://localhost/api/operator/smoke-case",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ));
    expect(unauthenticated.status).toBe(401);

    const invalid = await createSmokeCase(new Request(
      "http://localhost/api/operator/smoke-case",
      { method: "POST", headers, body: JSON.stringify({ orderNumber: "NG-2050", correctionToken: correctionToken }) },
    ));
    expect(invalid.status).toBe(422);

    const creationToken = "test-smoke-creation-token-which-is-long-and-url-safe-02";
    const response = await createSmokeCase(new Request(
      "http://localhost/api/operator/smoke-case",
      { method: "POST", headers, body: JSON.stringify({ orderNumber: "NG-2049", correctionToken: creationToken }) },
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.created).toBe(true);
    expect(body.case.order.orderNumber).toBe("NG-2049");

    const duplicate = await createSmokeCase(new Request(
      "http://localhost/api/operator/smoke-case",
      { method: "POST", headers, body: JSON.stringify({ orderNumber: "NG-2049", correctionToken: creationToken }) },
    ));
    expect((await duplicate.json()).created).toBe(false);
  });
});
