import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { approvals, bookings, correctionRequests, evidenceReceipts, jobs, agentTasks, quoteAttempts } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-client";
import { DemoRepository } from "@/server/db/repository";
import { seedDemoScenario } from "../../scripts/seed-demo";
import { runWorkerOnce } from "@/worker/main";

describe("durable NG-2048 recovery workflow", () => {
  let database: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it("pauses for customer input and approval, then independently verifies one idempotent booking", async () => {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const correctionToken = "test-correction-token-which-is-long-and-url-safe-2048";
    const fixture = await seedDemoScenario(repository, { correctionToken });

    const publicBeforeStart = await repository.getCaseSnapshot(fixture.caseId);
    expect(publicBeforeStart).toMatchObject({
      order: { orderNumber: "NG-2048", amountNgn: 65_000, currency: "NGN" },
      status: "NEW",
    });
    expect(JSON.stringify(publicBeforeStart)).not.toContain("recipient@example.com");
    expect(JSON.stringify(publicBeforeStart)).not.toContain(correctionToken);

    const firstStart = await repository.startCase(fixture.caseId);
    const secondStart = await repository.startCase(fixture.caseId);
    expect(secondStart.runId).toBe(firstStart.runId);
    expect(secondStart.snapshot.status).toBe("TRIAGING");

    await drainUntil(repository, fixture.caseId, "WAITING_CUSTOMER");
    const waiting = await repository.getCaseSnapshot(fixture.caseId);
    if (!waiting) throw new Error("Expected seeded case snapshot");
    expect(waiting.status).toBe("WAITING_CUSTOMER");
    expect(waiting.correctionRequest?.status).toBe("PENDING");

    await repository.applyCustomerCorrection(correctionToken, {
      landmark: "Opposite the fictional market gate",
    });
    await drainUntil(repository, fixture.caseId, "WAITING_APPROVAL");

    const approvalSnapshot = await repository.getCaseSnapshot(fixture.caseId);
    if (!approvalSnapshot) throw new Error("Expected seeded case snapshot");
    expect(approvalSnapshot.status).toBe("WAITING_APPROVAL");
    expect(approvalSnapshot.pendingApproval).toMatchObject({
      requestedCostNgn: 7_200,
      status: "PENDING",
    });

    const faultEvents = await repository.listCaseEvents(fixture.caseId, 0);
    expect(faultEvents.some((event) => event.type === "TOOL_FAILED" && event.payload.resultCode === "PROVIDER_503")).toBe(true);
    expect(faultEvents.some((event) => event.type === "FALLBACK_SELECTED")).toBe(true);
    expect(faultEvents.every((event, index) => index === 0 || event.seq > faultEvents[index - 1]!.seq)).toBe(true);

    await repository.decideApproval(
      fixture.caseId,
      approvalSnapshot.pendingApproval!.id,
      { decision: "approve", expectedVersion: approvalSnapshot.version },
    );
    await drainUntil(repository, fixture.caseId, "RESOLVED");

    const resolved = await repository.getCaseSnapshot(fixture.caseId);
    if (!resolved) throw new Error("Expected seeded case snapshot");
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.evidence).toMatchObject({ result: "PASS", adapterMode: "DEMO_SANDBOX" });
    expect(JSON.stringify(resolved.evidence).toLowerCase()).not.toContain("deliver");

    const persistedBookings = await database.db.select().from(bookings);
    const [receipt] = await database.db.select().from(evidenceReceipts);
    expect(persistedBookings).toHaveLength(1);
    expect(receipt?.result).toBe("PASS");
    expect(await repository.verifyBookingAgain(fixture.caseId)).toMatchObject({ result: "PASS" });

    const persistedCorrection = await database.db.select().from(correctionRequests);
    expect(persistedCorrection).toHaveLength(1);
    expect(persistedCorrection[0]?.tokenHash).toBe(
      createHash("sha256").update(correctionToken).digest("hex"),
    );
    expect(persistedCorrection[0]?.tokenHash).not.toBe(correctionToken);

    const persistedTasks = await database.db.select().from(agentTasks);
    expect(new Set(persistedTasks.map((task) => task.role))).toEqual(
      new Set(["controller", "investigator", "liaison", "fulfillment", "recovery", "verifier"]),
    );
    const persistedJobs = await database.db.select().from(jobs);
    expect(persistedJobs.length).toBeGreaterThan(0);
    expect(persistedJobs.every((job) => job.state === "COMPLETED")).toBe(true);
    const persistedApprovals = await database.db.select().from(approvals);
    expect(persistedApprovals[0]?.status).toBe("APPROVED");

    const finalEvents = await repository.listCaseEvents(fixture.caseId, 0);
    expect(finalEvents.at(-1)?.type).toBe("CASE_RESOLVED");
    expect(finalEvents.every((event, index) => index === 0 || event.seq > finalEvents[index - 1]!.seq)).toBe(true);
    expect(finalEvents.length).toBeGreaterThan(faultEvents.length);
  });

  it("keeps a correction token pending until the merged address has every required field", async () => {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const correctionToken = "test-correction-token-which-is-long-and-url-safe-2048";
    const fixture = await seedDemoScenario(repository, { correctionToken });

    await repository.startCase(fixture.caseId);
    await drainUntil(repository, fixture.caseId, "WAITING_CUSTOMER");

    await expect(repository.applyCustomerCorrection(correctionToken, { area: "Lekki" }))
      .rejects.toMatchObject({ status: 422, code: "CORRECTION_INCOMPLETE" });

    const [pendingRequest] = await database.db.select().from(correctionRequests);
    expect(pendingRequest?.status).toBe("PENDING");
    expect((await repository.getCaseSnapshot(fixture.caseId))?.status).toBe("WAITING_CUSTOMER");

    const resumed = await repository.applyCustomerCorrection(correctionToken, {
      landmark: "Opposite the fictional market gate",
    });
    expect(resumed.status).toBe("QUOTING");
  });

  it("reproduces the baseline failure after the persisted 503 without fallback or booking", async () => {
    database = await createTestDb();
    const repository = new DemoRepository(database.db);
    const correctionToken = "test-correction-token-which-is-long-and-url-safe-2048";
    const fixture = await seedDemoScenario(repository, { correctionToken });

    await repository.startCase(fixture.caseId);
    await drainUntil(repository, fixture.caseId, "WAITING_CUSTOMER");
    await repository.applyCustomerCorrection(correctionToken, {
      landmark: "Opposite the fictional market gate",
    });
    await drainUntil(repository, fixture.caseId, "ESCALATED", {
      agentEnv: { NENTRA_RECOVERY_MODE: "BASELINE" },
    });

    const snapshot = await repository.getCaseSnapshot(fixture.caseId);
    expect(snapshot?.status).toBe("ESCALATED");
    expect(snapshot?.order.fulfillmentStatus).toBe("BLOCKED");

    const quoteRows = await database.db.select().from(quoteAttempts);
    expect(quoteRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: "PREFERRED", status: "FAILED", resultCode: "PROVIDER_503" }),
    ]));
    expect(quoteRows.some((quote) => quote.route === "ALTERNATIVE")).toBe(false);
    expect(await database.db.select().from(bookings)).toHaveLength(0);

    const events = await repository.listCaseEvents(fixture.caseId, 0);
    expect(events.some((event) => event.type === "TOOL_FAILED" && event.payload.resultCode === "PROVIDER_503")).toBe(true);
    expect(events.some((event) => event.type === "CASE_ESCALATED" && event.payload.resultCode === "BASELINE_UNRECOVERED")).toBe(true);
    expect(events.some((event) => event.type === "FALLBACK_SELECTED")).toBe(false);

    const persistedTasks = await database.db.select().from(agentTasks);
    expect(persistedTasks.some((task) => task.role === "recovery")).toBe(false);
  });
});

async function drainUntil(
  repository: DemoRepository,
  caseId: string,
  expectedStatus: string,
  options: { agentEnv?: { NENTRA_RECOVERY_MODE?: "BASELINE" | "RECOVERED" } } = {},
): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    const snapshot = await repository.getCaseSnapshot(caseId);
    if (!snapshot) throw new Error("Expected case snapshot while draining");
    if (snapshot.status === expectedStatus) return;
    const result = await runWorkerOnce(repository, { agentEnv: options.agentEnv ?? {} });
    if (result === "idle") {
      throw new Error(`Worker became idle in ${snapshot.status} before ${expectedStatus}`);
    }
  }

  throw new Error(`Worker exceeded the step budget before ${expectedStatus}`);
}
