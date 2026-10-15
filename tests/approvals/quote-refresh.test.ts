import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/server/db/client", () => ({
  getDb: () => testState.db,
  closeDb: vi.fn(),
}));

import { eq } from "drizzle-orm";

import { POST as refreshApproval } from "@/app/api/cases/[caseId]/approvals/refresh/route";
import { SandboxShippingAdapter } from "@/integrations/shipping";
import { DemoRepository } from "@/server/db/repository";
import { approvals, bookings, jobs, quoteOptions } from "@/server/db/schema";
import { createTestDb, type TestDbInstance } from "@/server/db/test-client";
import { runWorkerOnce } from "@/worker/main";
import { seedDemoScenario } from "../../scripts/seed-demo";

const operatorSecret = "test-approval-operator-secret";

describe("expired quote recovery and merchant approval", () => {
  let database: TestDbInstance | undefined;
  let repository: DemoRepository;
  let caseId: string;
  let orderId: string;

  async function drainUntil(status: string): Promise<void> {
    for (let step = 0; step < 30; step += 1) {
      const snapshot = await repository.getCaseSnapshot(caseId);
      if (snapshot?.status === status) return;
      const result = await runWorkerOnce(repository, { agentEnv: {} });
      if (result === "idle") throw new Error(`Worker became idle before ${status}`);
    }
    throw new Error(`Worker exceeded the step budget before ${status}`);
  }

  async function driveToApproval(correctionToken: string): Promise<void> {
    await repository.startCase(caseId);
    await drainUntil("WAITING_CUSTOMER");
    const pending = await repository.getCorrectionRequestForCase(caseId);
    expect(pending).not.toBeNull();
    await repository.applyWhatsappCorrectionByRequestId(pending!.id, {
      landmark: "Opposite the fictional market gate",
    });
    await drainUntil("WAITING_APPROVAL");
  }

  async function expirePendingQuote(): Promise<{ approvalId: string; quoteId: string }> {
    const snapshot = await repository.getCaseSnapshot(caseId);
    const approvalId = snapshot!.pendingApproval!.id;
    const quoteId = snapshot!.pendingApproval!.quoteOptionId!;
    await database!.db.update(quoteOptions).set({
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(),
    }).where(eq(quoteOptions.id, quoteId));
    return { approvalId, quoteId };
  }

  function requestFreshQuote() {
    const adapter = new SandboxShippingAdapter(repository, { maxShippingNgn: 6_500 });
    return (route: "PREFERRED" | "ALTERNATIVE") => adapter.getQuotes({
      caseId,
      orderId,
      route,
      currency: "NGN",
      origin: { area: "Ikeja", state: "Lagos", countryCode: "NG" },
      destination: { area: "Lekki", state: "Lagos", countryCode: "NG" },
      parcel: { description: "Fictional retail order", weightGrams: 1_500 },
    }).then((quote) => ({
      id: quote.id,
      providerCode: quote.providerCode,
      serviceCode: quote.serviceCode,
      amountNgn: quote.amountNgn,
      expiresAt: quote.expiresAt,
    }));
  }

  beforeEach(async () => {
    process.env.NENTRA_DEMO_OPERATOR_SECRET = operatorSecret;
    database = await createTestDb();
    testState.db = database.db;
    repository = new DemoRepository(database.db);
    const fixture = await seedDemoScenario(repository, {
      correctionToken: `test-approval-token-which-is-long-and-url-safe-${Date.now()}`,
    });
    caseId = fixture.caseId;
    orderId = (await repository.getCaseSnapshot(caseId))!.order.id;
  });

  afterEach(async () => {
    delete process.env.NENTRA_DEMO_OPERATOR_SECRET;
    testState.db = undefined;
    await database?.close();
    database = undefined;
  });

  it("refuses to approve an expired quote and marks the approval expired", async () => {
    await driveToApproval("test-approval-correction-expired-1");
    const { approvalId } = await expirePendingQuote();
    await expect(repository.decideApproval(caseId, approvalId, { decision: "approve" }))
      .rejects.toMatchObject({ code: "QUOTE_EXPIRED", status: 409 });
    const [approval] = await database!.db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(approval!.status).toBe("EXPIRED");
    expect((await repository.getCaseSnapshot(caseId))?.status).toBe("WAITING_APPROVAL");
    const events = await repository.listCaseEvents(caseId);
    expect(events.some((event) => (event.payload as { resultCode?: string }).resultCode === "QUOTE_EXPIRED")).toBe(true);
  });

  it("refreshes an expired quote into a new exact-quote approval on the same run", async () => {
    await driveToApproval("test-approval-correction-refresh-1");
    const runBefore = (await repository.getCaseSnapshot(caseId))!.run!.id;
    const { approvalId: oldApprovalId, quoteId: oldQuoteId } = await expirePendingQuote();
    const refreshed = await repository.refreshApprovalQuote(caseId, { requestQuote: requestFreshQuote() });
    expect(refreshed.status).toBe("WAITING_APPROVAL");
    expect(refreshed.run!.id).toBe(runBefore);
    expect(refreshed.pendingApproval!.id).not.toBe(oldApprovalId);
    expect(refreshed.pendingApproval!.quoteOptionId).not.toBe(oldQuoteId);
    expect(refreshed.pendingApproval!.status).toBe("PENDING");
    expect(refreshed.pendingApproval!.requestedCostNgn).toBe(7_200);
    expect(Date.parse(refreshed.pendingApproval!.expiresAt!)).toBeGreaterThan(Date.now());
    const [oldApproval] = await database!.db.select().from(approvals).where(eq(approvals.id, oldApprovalId));
    expect(oldApproval!.status).toBe("EXPIRED");
    expect(await database!.db.select().from(bookings).where(eq(bookings.caseId, caseId))).toHaveLength(0);
    const events = await repository.listCaseEvents(caseId);
    const codes = events.map((event) => (event.payload as { resultCode?: string }).resultCode);
    expect(codes).toContain("APPROVAL_SUPERSEDED");
    expect(codes).toContain("COST_LIMIT");
  });

  it("rejects the superseded approval and concurrent refreshes", async () => {
    await driveToApproval("test-approval-correction-race-1");
    const { approvalId: oldApprovalId } = await expirePendingQuote();
    const other = new DemoRepository(database!.db);
    const [first, second] = await Promise.allSettled([
      repository.refreshApprovalQuote(caseId, { requestQuote: requestFreshQuote() }),
      other.refreshApprovalQuote(caseId, { requestQuote: requestFreshQuote() }),
    ]);
    const fulfilled = [first, second].filter((outcome) => outcome.status === "fulfilled");
    const rejected = [first, second].filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
    expect(["APPROVAL_SUPERSEDED", "QUOTE_STILL_VALID"]).toContain(reason.code);
    const pendings = await database!.db.select().from(approvals)
      .where(eq(approvals.caseId, caseId));
    expect(pendings.filter((row) => row.status === "PENDING")).toHaveLength(1);
    await expect(repository.decideApproval(caseId, oldApprovalId, { decision: "approve" }))
      .rejects.toMatchObject({ code: "APPROVAL_ALREADY_REVIEWED" });
  });

  it("approves the fresh exact quote once and resumes the same run into booking", async () => {
    await driveToApproval("test-approval-correction-approve-1");
    const runBefore = (await repository.getCaseSnapshot(caseId))!.run!.id;
    await expirePendingQuote();
    const refreshed = await repository.refreshApprovalQuote(caseId, { requestQuote: requestFreshQuote() });
    const approved = await repository.decideApproval(caseId, refreshed.pendingApproval!.id, {
      decision: "approve",
      expectedVersion: refreshed.version,
    });
    expect(approved.status).toBe("BOOKING");
    expect(approved.run!.id).toBe(runBefore);
    const bookingJobs = await database!.db.select().from(jobs)
      .where(eq(jobs.caseId, caseId));
    expect(bookingJobs.some((job) => (job.payloadJson as { approvalId?: string } | null)?.approvalId === refreshed.pendingApproval!.id)).toBe(true);
    await expect(repository.decideApproval(caseId, refreshed.pendingApproval!.id, { decision: "approve" }))
      .rejects.toMatchObject({ code: "CASE_NOT_WAITING_FOR_APPROVAL" });
  });

  it("escalates a rejected approval without touching quotes", async () => {
    await driveToApproval("test-approval-correction-reject-1");
    const snapshot = await repository.getCaseSnapshot(caseId);
    const rejected = await repository.decideApproval(caseId, snapshot!.pendingApproval!.id, {
      decision: "reject",
      reason: "Too expensive for this demo",
    });
    expect(rejected.status).toBe("ESCALATED");
  });

  it("serves quote refresh through the authenticated operator route", async () => {
    await driveToApproval("test-approval-correction-route-1");
    await expirePendingQuote();
    const unauthenticated = await refreshApproval(new Request(
      `http://localhost/api/cases/${caseId}/approvals/refresh`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ), { params: Promise.resolve({ caseId }) });
    expect(unauthenticated.status).toBe(401);

    const headers = { "content-type": "application/json", "x-nentra-operator-secret": operatorSecret };
    const response = await refreshApproval(new Request(
      `http://localhost/api/cases/${caseId}/approvals/refresh`,
      { method: "POST", headers, body: "{}" },
    ), { params: Promise.resolve({ caseId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state).toBe("WAITING_APPROVAL");
    expect(body.case.pendingApproval.requestedCostNgn).toBe(7_200);
    expect(Date.parse(body.case.pendingApproval.expiresAt)).toBeGreaterThan(Date.now());
  });
});
