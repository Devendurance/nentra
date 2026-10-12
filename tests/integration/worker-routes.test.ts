import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/server/db/client", () => ({
  getDb: () => testState.db,
  closeDb: vi.fn(),
}));

import { GET as getCases } from "@/app/api/cases/route";
import { GET as getCase } from "@/app/api/cases/[caseId]/route";
import { GET as getEvents } from "@/app/api/cases/[caseId]/events/route";
import { GET as getEvidence } from "@/app/api/cases/[caseId]/evidence/route";
import { POST as startCase } from "@/app/api/cases/[caseId]/start/route";
import { POST as cancelCase } from "@/app/api/cases/[caseId]/cancel/route";
import { POST as decideApproval } from "@/app/api/cases/[caseId]/approvals/[approvalId]/route";
import { POST as resetDemo } from "@/app/api/demo/reset/route";
import { POST as submitCorrection } from "@/app/api/customer-corrections/[token]/route";
import { DemoRepository } from "@/server/db/repository";
import { createTestDb, type TestDbInstance } from "@/server/db/test-client";
import { seedDemoScenario } from "../../scripts/seed-demo";
import { runWorkerOnce } from "@/worker/main";

const operatorSecret = "test-operator-secret";
const correctionToken = "test-correction-token-which-is-long-and-url-safe-2048";

describe("durable worker and App Router endpoints", () => {
  let database: TestDbInstance | undefined;
  let repository: DemoRepository;
  let fixture: Awaited<ReturnType<typeof seedDemoScenario>>;

  beforeEach(async () => {
    process.env.NENTRA_DEMO_OPERATOR_SECRET = operatorSecret;
    database = await createTestDb();
    testState.db = database.db;
    repository = new DemoRepository(database.db);
    fixture = await seedDemoScenario(repository, { correctionToken });
  });

  afterEach(async () => {
    delete process.env.NENTRA_DEMO_OPERATOR_SECRET;
    testState.db = undefined;
    await database?.close();
    database = undefined;
  });

  it("serves public case snapshots, ordered event deltas, and sanitized evidence", async () => {
    const listResponse = await getCases();
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("cache-control")).toBe("no-store");
    const listBody = await listResponse.json();
    expect(listBody.cases).toHaveLength(1);
    expect(listBody.cases[0]).toMatchObject({ id: fixture.caseId, status: "NEW" });

    const params = { params: Promise.resolve({ caseId: fixture.caseId }) };
    const caseResponse = await getCase(new Request("http://localhost/api/cases/case"), params);
    expect(caseResponse.status).toBe(200);
    expect((await caseResponse.json()).case.order.orderNumber).toBe("NG-2048");

    const started = await repository.startCase(fixture.caseId);
    const eventResponse = await getEvents(
      new Request("http://localhost/api/cases/case/events?after=1"),
      params,
    );
    expect(eventResponse.status).toBe(200);
    const eventsBody = await eventResponse.json();
    expect(eventsBody.events.length).toBeGreaterThan(0);
    expect(eventsBody.events.every((event: { seq: number }) => event.seq > 1)).toBe(true);
    expect(eventsBody.after).toBeGreaterThanOrEqual(started.snapshot.version);

    const evidenceResponse = await getEvidence(
      new Request("http://localhost/api/cases/case/evidence"),
      params,
    );
    expect(evidenceResponse.status).toBe(200);
    expect((await evidenceResponse.json()).evidence).toEqual([]);
  });

  it("protects operator actions, makes start idempotent, and supports safe cancellation and reset", async () => {
    const routeContext = { params: Promise.resolve({ caseId: fixture.caseId }) };
    const unauthenticated = await startCase(
      new Request("http://localhost/api/cases/case/start", { method: "POST", body: "{}" }),
      routeContext,
    );
    expect(unauthenticated.status).toBe(401);

    const headers = { "content-type": "application/json", "x-nentra-operator-secret": operatorSecret };
    const first = await startCase(new Request("http://localhost/api/cases/case/start", {
      method: "POST", headers, body: JSON.stringify({ expectedVersion: 0 }),
    }), routeContext);
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    const second = await startCase(new Request("http://localhost/api/cases/case/start", {
      method: "POST", headers, body: JSON.stringify({ expectedVersion: 0 }),
    }), routeContext);
    expect(second.status).toBe(200);
    expect((await second.json()).runId).toBe(firstBody.runId);

    await runWorkerOnce(repository, { agentEnv: {} });
    const cancelled = await cancelCase(new Request("http://localhost/api/cases/case/cancel", {
      method: "POST", headers, body: JSON.stringify({ reason: "Operator stopped this demo" }),
    }), routeContext);
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).case.status).toBe("CANCELLED");

    const reset = await resetDemo(new Request("http://localhost/api/demo/reset", {
      method: "POST", headers, body: "{}",
    }));
    expect(reset.status).toBe(200);
    expect((await reset.json()).case.status).toBe("NEW");
  });

  it("accepts a scoped correction, resumes leased steps, requests approval, then verifies the booking", async () => {
    const routeContext = { params: Promise.resolve({ caseId: fixture.caseId }) };
    const headers = { "content-type": "application/json", "x-nentra-operator-secret": operatorSecret };
    const started = await startCase(new Request("http://localhost/api/cases/case/start", {
      method: "POST", headers, body: "{}",
    }), routeContext);
    expect(started.status).toBe(202);

    await drainUntil(repository, fixture.caseId, "WAITING_CUSTOMER");
    const invalidToken = await submitCorrection(new Request("http://localhost/api/customer-corrections/invalid-token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ landmark: "Opposite the fictional market gate" }),
    }), { params: Promise.resolve({ token: "invalid-token" }) });
    expect(invalidToken.status).toBe(422);

    const corrected = await submitCorrection(new Request(`http://localhost/api/customer-corrections/${correctionToken}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ landmark: "Opposite the fictional market gate" }),
    }), { params: Promise.resolve({ token: correctionToken }) });
    expect(corrected.status).toBe(200);
    expect((await corrected.json()).case.status).toBe("QUOTING");
    const reused = await submitCorrection(new Request(`http://localhost/api/customer-corrections/${correctionToken}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ landmark: "Second use" }),
    }), { params: Promise.resolve({ token: correctionToken }) });
    expect(reused.status).toBe(403);

    await drainUntil(repository, fixture.caseId, "WAITING_APPROVAL");
    const approvalSnapshot = await repository.getCaseSnapshot(fixture.caseId);
    expect(approvalSnapshot?.pendingApproval?.requestedCostNgn).toBe(7_200);
    const approvalContext = {
      params: Promise.resolve({ caseId: fixture.caseId, approvalId: approvalSnapshot!.pendingApproval!.id }),
    };
    const approval = await decideApproval(new Request("http://localhost/api/cases/case/approvals/approval", {
      method: "POST", headers,
      body: JSON.stringify({ decision: "approve", expectedVersion: approvalSnapshot!.version }),
    }), approvalContext);
    expect(approval.status).toBe(200);
    expect((await approval.json()).case.status).toBe("BOOKING");

    await drainUntil(repository, fixture.caseId, "RESOLVED");
    const finalCase = await repository.getCaseSnapshot(fixture.caseId);
    expect(finalCase?.evidence).toMatchObject({ result: "PASS", adapterMode: "DEMO_SANDBOX" });
    expect(JSON.stringify(finalCase?.evidence).toLowerCase()).not.toContain("deliver");
    const events = await repository.listCaseEvents(fixture.caseId);
    expect(events.some((event) => event.type === "TOOL_FAILED")).toBe(true);
    expect(events.some((event) => event.type === "FALLBACK_SELECTED")).toBe(true);
    expect(events.at(-1)?.type).toBe("CASE_RESOLVED");
    const publicEvidence = await getEvidence(
      new Request("http://localhost/api/cases/case/evidence"),
      routeContext,
    );
    expect((await publicEvidence.json()).evidence[0].result).toBe("PASS");
  });
});

async function drainUntil(repository: DemoRepository, caseId: string, status: string): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    const snapshot = await repository.getCaseSnapshot(caseId);
    if (snapshot?.status === status) return;
    const result = await runWorkerOnce(repository, { agentEnv: {} });
    if (result === "idle") throw new Error(`Worker became idle before ${status}`);
  }
  throw new Error(`Worker exceeded the step budget before ${status}`);
}
