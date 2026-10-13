import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import { PgTransaction, type PgQueryResultHKT } from "drizzle-orm/pg-core";

import { transitionCaseStatus, type CaseStatus } from "@/domain/cases/status";
import {
  sanitizeCaseEvent,
  type CaseEventActor,
  type CaseEventType,
} from "@/domain/events/case-event";
import { correctionInputSchema } from "@/server/api/schemas";
import { HttpError } from "@/server/api/errors";
import type {
  BookingIntent,
  BookingRequest,
  SandboxBooking,
  ShippingQuote,
  ShippingStore,
} from "@/integrations/shipping";
import type { Database } from "@/server/db/client";
import type { TestDatabase } from "@/server/db/test-client";
import {
  approvals,
  agentTasks,
  bookingIntents,
  bookings,
  cases,
  caseEvents,
  correctionRequests,
  demoFaults,
  evidenceReceipts,
  jobs,
  merchants,
  orders,
  quoteAttempts,
  quoteOptions,
  runs,
  toolAttempts,
  whatsappInboundEvents,
  whatsappMessages,
  type AgentTask,
  type ClaimedJob,
  type CaseRecord,
  type CaseEvent as CaseEventRecord,
  type Job,
  type Run,
} from "@/server/db/schema";

export type RepositoryDatabase = Database | TestDatabase;
export type RepositoryTransaction = PgTransaction<PgQueryResultHKT, Record<string, unknown>, never>;

export type PublicCaseEvent = ReturnType<typeof sanitizeCaseEvent>;

export type PublicCaseSnapshot = {
  id: string;
  status: CaseStatus;
  blocker: string | null;
  version: number;
  updatedAt: string;
  order: {
    id: string;
    orderNumber: string;
    amountNgn: number;
    currency: "NGN";
    paymentStatus: "PAID" | "UNPAID" | "UNKNOWN";
    fulfillmentStatus: string;
    originArea: string;
    destinationArea: string;
    destinationCity: string;
  };
  merchant: { id: string; name: string; maxShippingNgn: number; mode: string };
  run: { id: string; attempt: number; status: string; traceRef?: string } | null;
  correctionRequest: { status: string; expiresAt: string } | null;
  pendingApproval: {
    id: string;
    status: string;
    requestedCostNgn: number;
    merchantCeilingNgn: number;
    provider: string | null;
    service: string | null;
  } | null;
  evidence: PublicEvidence | null;
};

export type PublicEvidence = {
  id: string;
  result: "PASS" | "FAIL";
  verifiedAt: string;
  adapterMode: string;
  provider: string;
  service: string;
  providerBookingId: string;
  amountNgn: number;
  currency: "NGN";
  checks: Record<string, boolean>;
};

export type CaseTransition = {
  to: CaseStatus;
  actor: CaseEventActor;
  type: CaseEventType;
  payload: Record<string, unknown>;
  verificationResult?: "PASS" | "FAIL" | "PENDING";
};

export type PublicEventInput = {
  type: CaseEventType;
  actor: CaseEventActor;
  taskId?: string;
  payload: Record<string, unknown>;
};

export type NewTaskInput = {
  runId: string;
  role: AgentTask["role"];
  goal: string;
  inputJson: Record<string, unknown>;
};

export type CommitJobStepInput = {
  jobId: string;
  workerId: string;
  leaseToken: string;
  taskId: string;
  outputJson: Record<string, unknown>;
  taskStatus?: "COMPLETED" | "FAILED" | "WAITING";
  summary: string;
  actor: CaseEventActor;
  transitions?: CaseTransition[];
  events?: PublicEventInput[];
  nextStep?: string;
  nextPayload?: Record<string, unknown>;
  runStatus?: Run["status"];
  evidenceReceipt?: {
    bookingId: string;
    result: "PASS" | "FAIL";
    verificationJson: Record<string, unknown>;
  };
  pendingApproval?: {
    quoteOptionId: string;
    proposalHash: string;
    requestedCostNgn: number;
  };
  orderFulfillmentStatus?: "BLOCKED" | "READY" | "BOOKED" | "CANCELLED";
};

const DEMO_MERCHANT_NAME = "Nentra Fictional Merchant";
const DEMO_ORDER_NUMBER = "NG-2048";
const DEMO_CASE_ID = "20480000-0000-4000-8000-000000000001";
const DEMO_ORDER_ID = "20480000-0000-4000-8000-000000000002";
const DEMO_MERCHANT_ID = "20480000-0000-4000-8000-000000000003";

function eventText(input: unknown, fallback: string): string {
  if (typeof input === "string" && input.trim()) return input.trim().slice(0, 400);
  return fallback;
}

function safePublicPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    title: eventText(payload.title, "Workflow update"),
    summary: eventText(payload.summary, "The workflow recorded a status update."),
    ...(typeof payload.station === "string" ? { station: payload.station.slice(0, 80) } : {}),
    ...(typeof payload.resultCode === "string" ? { resultCode: payload.resultCode.slice(0, 80) } : {}),
    ...(typeof payload.nextAction === "string" ? { nextAction: payload.nextAction.slice(0, 200) } : {}),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function missingDeliveryFields(address: Record<string, unknown>): string[] {
  const required: Array<[string, unknown]> = [
    ["street", address.addressLine1],
    ["area", address.area],
    ["landmark", address.landmark],
    ["city", address.city],
    ["state", address.state],
  ];
  return required
    .filter(([, value]) => typeof value !== "string" || value.trim().length === 0)
    .map(([field]) => field);
}

function iso(value: Date): string {
  return value.toISOString();
}

function leaseWhere(jobId: string, workerId: string, leaseToken: string) {
  return and(
    eq(jobs.id, jobId),
    eq(jobs.state, "RUNNING"),
    eq(jobs.leaseOwner, workerId),
    eq(jobs.leaseToken, leaseToken),
    sql`${jobs.leaseUntil} > now()`,
  );
}

function requireCurrentLease(job: Job | undefined, workerId: string, leaseToken: string): asserts job is Job {
  if (!job
    || job.state !== "RUNNING"
    || job.leaseOwner !== workerId
    || !leaseToken
    || job.leaseToken !== leaseToken
    || !job.leaseUntil
    || job.leaseUntil.getTime() <= Date.now()) {
    throw error(409, "JOB_LEASE_LOST", "The worker lease is no longer current.");
  }
}

function error(status: number, code: string, message: string): HttpError {
  return new HttpError(status, code, message);
}

async function applyCorrectionTx(
  tx: RepositoryTransaction,
  request: { id: string; caseId: string },
  input: { houseNumber?: string; street?: string; area?: string; landmark?: string },
): Promise<string> {
  const row = await lockCase(tx, request.caseId);
  if (row.status !== "WAITING_CUSTOMER" || !row.activeRunId) {
    throw error(409, "CASE_NOT_WAITING_FOR_CUSTOMER", "The case is not waiting for this correction.");
  }
  const now = new Date();
  const [order] = await tx.select().from(orders).where(eq(orders.id, row.orderId)).for("update").limit(1);
  if (!order) throw error(404, "ORDER_NOT_FOUND", "Order was not found.");
  const address = { ...objectValue(order.addressJson) };
  const houseNumber = input.houseNumber;
  const street = input.street;
  if (houseNumber || street) {
    const existingStreet = typeof address.addressLine1 === "string" ? address.addressLine1 : "";
    address.addressLine1 = [houseNumber, street].filter(Boolean).join(" ") || existingStreet;
  }
  if (input.area) address.area = input.area;
  if (input.landmark) address.landmark = input.landmark;

  if (missingDeliveryFields(address).length > 0) {
    throw error(422, "CORRECTION_INCOMPLETE", "All required delivery details must be present before quote review can resume.");
  }

  await tx.update(orders).set({ addressJson: address, updatedAt: now }).where(eq(orders.id, order.id));
  await tx.update(correctionRequests).set({ status: "COMPLETED", completedAt: now, updatedAt: now }).where(eq(correctionRequests.id, request.id));
  await tx.update(agentTasks).set({ status: "COMPLETED", outputJson: { result: "CUSTOMER_INPUT_RECEIVED" }, finishedAt: now, updatedAt: now })
    .where(and(eq(agentTasks.runId, row.activeRunId), eq(agentTasks.role, "liaison"), eq(agentTasks.status, "WAITING")));
  const afterCustomer = await transitionCaseTx(tx, row, {
    to: "TRIAGING",
    actor: "customer",
    type: "CUSTOMER_INPUT_RECEIVED",
    payload: { title: "Address detail received", summary: "The requested fictional delivery landmark was added.", station: "liaison", nextAction: "Continue quote evaluation" },
  }, row.activeRunId);
  await transitionCaseTx(tx, afterCustomer, {
    to: "QUOTING",
    actor: "controller",
    type: "PLAN_CREATED",
    payload: { title: "Quote review resumed", summary: "The corrected address is ready for eligible shipping quotes.", station: "controller", nextAction: "Request the preferred shipping quote" },
  }, row.activeRunId);
  await tx.update(runs).set({ status: "RUNNING", updatedAt: now }).where(eq(runs.id, row.activeRunId));
  await insertJobTx(tx, {
    caseId: row.id,
    runId: row.activeRunId,
    step: "fulfillment_primary",
    dedupeKey: `${row.activeRunId}:fulfillment_primary:1`,
  });
  return row.id;
}

export class DemoRepository implements ShippingStore {
  constructor(readonly db: RepositoryDatabase) {}

  async transaction<T>(callback: (tx: RepositoryTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx as unknown as RepositoryTransaction));
  }

  async listCases(): Promise<PublicCaseSnapshot[]> {
    const rows = await this.db
      .select({ caseId: cases.id })
      .from(cases)
      .innerJoin(orders, eq(cases.orderId, orders.id))
      .innerJoin(merchants, eq(orders.merchantId, merchants.id))
      .where(and(eq(orders.orderNumber, DEMO_ORDER_NUMBER), eq(merchants.name, DEMO_MERCHANT_NAME), eq(merchants.mode, "DEMO_SANDBOX")))
      .orderBy(desc(cases.updatedAt), asc(cases.id));
    const snapshots = await Promise.all(rows.map(({ caseId }) => this.getCaseSnapshot(caseId)));
    return snapshots.filter((snapshot): snapshot is PublicCaseSnapshot => snapshot !== null);
  }

  async getCaseSnapshot(caseId: string): Promise<PublicCaseSnapshot | null> {
    const [joined] = await this.db
      .select({
        caseRecord: cases,
        orderRecord: orders,
        merchantRecord: merchants,
      })
      .from(cases)
      .innerJoin(orders, eq(cases.orderId, orders.id))
      .innerJoin(merchants, eq(orders.merchantId, merchants.id))
      .where(and(
        eq(cases.id, caseId),
        eq(orders.orderNumber, DEMO_ORDER_NUMBER),
        eq(merchants.name, DEMO_MERCHANT_NAME),
        eq(merchants.mode, "DEMO_SANDBOX"),
      ))
      .limit(1);
    if (!joined) return null;

    const [run] = joined.caseRecord.activeRunId
      ? await this.db.select().from(runs).where(eq(runs.id, joined.caseRecord.activeRunId)).limit(1)
      : [];
    const [correction] = await this.db
      .select({ status: correctionRequests.status, expiresAt: correctionRequests.expiresAt })
      .from(correctionRequests)
      .where(and(eq(correctionRequests.caseId, caseId), eq(correctionRequests.status, "PENDING")))
      .orderBy(desc(correctionRequests.createdAt))
      .limit(1);
    const [approval] = await this.db
      .select({ approval: approvals, quote: quoteOptions })
      .from(approvals)
      .leftJoin(quoteOptions, eq(approvals.quoteOptionId, quoteOptions.id))
      .where(and(eq(approvals.caseId, caseId), eq(approvals.status, "PENDING")))
      .orderBy(desc(approvals.createdAt))
      .limit(1);
    const [receipt] = await this.db
      .select({ receipt: evidenceReceipts, booking: bookings, intent: bookingIntents, quote: quoteOptions })
      .from(evidenceReceipts)
      .innerJoin(bookings, eq(evidenceReceipts.bookingId, bookings.id))
      .innerJoin(bookingIntents, eq(bookings.bookingIntentId, bookingIntents.id))
      .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
      .where(eq(evidenceReceipts.caseId, caseId))
      .orderBy(desc(evidenceReceipts.verifiedAt))
      .limit(1);

    const address = objectValue(joined.orderRecord.addressJson);
    const receiptVerification = objectValue(receipt?.receipt.verificationJson);
    const checks = objectValue(receiptVerification.checks);
    const safeChecks = Object.fromEntries(
      Object.entries(checks)
        .filter(([, value]) => typeof value === "boolean")
        .map(([key, value]) => [key.slice(0, 80), value]),
    ) as Record<string, boolean>;

    return {
      id: joined.caseRecord.id,
      status: joined.caseRecord.status,
      blocker: joined.caseRecord.blocker,
      version: joined.caseRecord.version,
      updatedAt: iso(joined.caseRecord.updatedAt),
      order: {
        id: joined.orderRecord.id,
        orderNumber: joined.orderRecord.orderNumber,
        amountNgn: joined.orderRecord.amountNgn,
        currency: joined.merchantRecord.currency as "NGN",
        paymentStatus: joined.orderRecord.paymentStatus,
        fulfillmentStatus: joined.orderRecord.fulfillmentStatus,
        originArea: "Ikeja",
        destinationArea: typeof address.area === "string" ? address.area : "Lekki",
        destinationCity: typeof address.city === "string" ? address.city : "Lagos",
      },
      merchant: {
        id: joined.merchantRecord.id,
        name: joined.merchantRecord.name,
        maxShippingNgn: joined.merchantRecord.maxShippingNgn,
        mode: joined.merchantRecord.mode,
      },
      run: run ? {
        id: run.id,
        attempt: run.attempt,
        status: run.status,
        ...(run.traceRef ? { traceRef: run.traceRef } : {}),
      } : null,
      correctionRequest: correction ? {
        status: correction.status,
        expiresAt: iso(correction.expiresAt),
      } : null,
      pendingApproval: approval ? {
        id: approval.approval.id,
        status: approval.approval.status,
        requestedCostNgn: approval.approval.requestedCostNgn,
        merchantCeilingNgn: joined.merchantRecord.maxShippingNgn,
        provider: approval.quote?.provider ?? null,
        service: approval.quote?.service ?? null,
      } : null,
      evidence: receipt ? {
        id: receipt.receipt.id,
        result: receipt.receipt.result,
        verifiedAt: iso(receipt.receipt.verifiedAt),
        adapterMode: receipt.booking.mode,
        provider: receipt.quote.provider,
        service: receipt.quote.service,
        providerBookingId: receipt.booking.providerBookingId ?? "",
        amountNgn: receipt.booking.costNgn,
        currency: "NGN",
        checks: safeChecks,
      } : null,
    };
  }

  async listCaseEvents(caseId: string, afterSequence = 0, limit = 100): Promise<PublicCaseEvent[]> {
    const rows = await this.db
      .select()
      .from(caseEvents)
      .where(and(eq(caseEvents.caseId, caseId), gte(caseEvents.seq, afterSequence + 1)))
      .orderBy(asc(caseEvents.seq))
      .limit(Math.max(1, Math.min(limit, 250)));
    return rows.map(toPublicEvent);
  }

  async listCaseEvidence(caseId: string): Promise<PublicEvidence[]> {
    const snapshot = await this.getCaseSnapshot(caseId);
    if (!snapshot) return [];
    const rows = await this.db
      .select({ receiptId: evidenceReceipts.id })
      .from(evidenceReceipts)
      .where(eq(evidenceReceipts.caseId, caseId))
      .orderBy(desc(evidenceReceipts.verifiedAt));
    if (rows.length === 0 || !snapshot.evidence) return [];
    return [snapshot.evidence];
  }

  async startCase(caseId: string, expectedVersion?: number): Promise<{
    accepted: boolean;
    runId: string;
    snapshot: PublicCaseSnapshot;
  }> {
    const started = await this.transaction(async (tx) => {
      const row = await lockCase(tx, caseId);
      checkExpectedVersion(row, expectedVersion);
      if (row.activeRunId && row.status !== "NEW") {
        if (["CANCELLED", "RESOLVED", "ESCALATED"].includes(row.status)) {
          throw error(409, "CASE_TERMINAL", "A terminal case cannot be started again.");
        }
        return { accepted: false, runId: row.activeRunId };
      }
      if (row.status !== "NEW") {
        throw error(409, "CASE_NOT_STARTABLE", "The case is not available to start.");
      }

      const [attemptRow] = await tx.select({ attempt: max(runs.attempt) }).from(runs).where(eq(runs.caseId, caseId));
      const [run] = await tx.insert(runs).values({
        caseId,
        attempt: (attemptRow?.attempt ?? 0) + 1,
        engineVersion: "nentra-durable-v1",
        status: "QUEUED",
      }).returning();
      if (!run) throw new Error("Could not create workflow run");

      const [task] = await tx.insert(agentTasks).values({
        runId: run.id,
        role: "controller",
        goal: "Create a bounded recovery plan and delegate the initial order review.",
        status: "QUEUED",
        inputJson: { orderNumber: DEMO_ORDER_NUMBER },
      }).returning();
      if (!task) throw new Error("Could not create controller task");

      const [updated] = await tx.update(cases).set({
        activeRunId: run.id,
        blocker: null,
        version: sql`${cases.version} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(cases.id, caseId), eq(cases.version, row.version))).returning();
      if (!updated) throw error(409, "CASE_VERSION_CONFLICT", "The case changed before it could start.");

      await transitionCaseTx(tx, updated, {
        to: "TRIAGING",
        actor: "controller",
        type: "CASE_STARTED",
        payload: { title: "Recovery started", summary: "The controller began a bounded review of order NG-2048.", station: "controller", nextAction: "Review order delivery details" },
      }, run.id);
      await appendEventTx(tx, {
        caseId,
        runId: run.id,
        type: "TASK_DELEGATED",
        actor: "controller",
        taskId: task.id,
        payload: { title: "Order review delegated", summary: "The investigator will check required delivery fields.", station: "investigator", nextAction: "Inspect address completeness" },
      });

      await tx.update(agentTasks).set({ status: "RUNNING", startedAt: new Date(), updatedAt: new Date() }).where(eq(agentTasks.id, task.id));
      await appendEventTx(tx, {
        caseId,
        runId: run.id,
        type: "AGENT_STARTED",
        actor: "controller",
        taskId: task.id,
        payload: { title: "Controller is planning", summary: "A deterministic workflow plan was recorded for the demo case.", station: "controller" },
      });
      await tx.insert(jobs).values({
        caseId,
        runId: run.id,
        step: "controller_plan",
        state: "READY",
        dedupeKey: `${run.id}:controller_plan:1`,
        payloadJson: { taskId: task.id },
      });
      return { accepted: true, runId: run.id };
    });

    const snapshot = await this.getCaseSnapshot(caseId);
    if (!snapshot) throw error(404, "CASE_NOT_FOUND", "Case was not found.");
    return { ...started, snapshot };
  }

  async cancelCase(caseId: string, input: { reason?: string; expectedVersion?: number } = {}): Promise<PublicCaseSnapshot> {
    await this.transaction(async (tx) => {
      const row = await lockCase(tx, caseId);
      checkExpectedVersion(row, input.expectedVersion);
      if (["RESOLVED", "ESCALATED", "CANCELLED", "BOOKING", "VERIFYING"].includes(row.status)) {
        throw error(409, "CASE_NOT_CANCELLABLE", "The case cannot be cancelled at this workflow boundary.");
      }
      const runId = row.activeRunId;
      if (!runId) throw error(409, "CASE_NOT_STARTED", "The case has no active recovery run.");
      const updated = await transitionCaseTx(tx, row, {
        to: "CANCELLED",
        actor: "merchant",
        type: "PLAN_CREATED",
        payload: { title: "Case cancelled", summary: input.reason ?? "The merchant cancelled this recovery run.", station: "controller" },
      }, runId);
      await tx.update(jobs).set({ state: "CANCELLED", leaseOwner: null, leaseToken: null, leaseUntil: null, completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jobs.caseId, caseId), inArray(jobs.state, ["READY", "RUNNING"])));
      await tx.update(runs).set({ status: "CANCELLED", finishedAt: new Date(), updatedAt: new Date() }).where(eq(runs.id, runId));
      await tx.update(agentTasks).set({ status: "CANCELLED", finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(agentTasks.runId, runId), inArray(agentTasks.status, ["QUEUED", "RUNNING", "WAITING"])));
      return updated;
    });
    const snapshot = await this.getCaseSnapshot(caseId);
    if (!snapshot) throw error(404, "CASE_NOT_FOUND", "Case was not found.");
    return snapshot;
  }

  async applyCustomerCorrection(token: string, rawInput: unknown): Promise<PublicCaseSnapshot> {
    const input = correctionInputSchema.parse(rawInput);
    const tokenHash = sha256(token);
    const caseId = await this.transaction(async (tx) => {
      const [request] = await tx.select().from(correctionRequests)
        .where(eq(correctionRequests.tokenHash, tokenHash)).for("update").limit(1);
      if (!request || request.status !== "PENDING") {
        throw error(403, "CORRECTION_TOKEN_INVALID", "The correction token is invalid or has already been used.");
      }
      const now = new Date();
      if (request.expiresAt.getTime() <= now.getTime()) {
        await tx.update(correctionRequests).set({ status: "EXPIRED", updatedAt: now }).where(eq(correctionRequests.id, request.id));
        return null;
      }

      return applyCorrectionTx(tx, { id: request.id, caseId: request.caseId }, input);
    });

    if (!caseId) throw error(403, "CORRECTION_TOKEN_EXPIRED", "The correction token has expired.");

    const snapshot = await this.getCaseSnapshot(caseId);
    if (!snapshot) throw error(404, "CASE_NOT_FOUND", "Case was not found.");
    return snapshot;
  }

  async applyWhatsappCorrectionByRequestId(
    requestId: string,
    rawInput: unknown,
  ): Promise<{ outcome: "APPLIED" | "EXPIRED" | "ALREADY_RESOLVED"; caseId: string | null }> {
    const input = correctionInputSchema.parse(rawInput);
    return this.transaction(async (tx) => {
      const [request] = await tx.select().from(correctionRequests)
        .where(eq(correctionRequests.id, requestId)).for("update").limit(1);
      if (!request || request.status !== "PENDING") {
        return { outcome: "ALREADY_RESOLVED" as const, caseId: request?.caseId ?? null };
      }
      const now = new Date();
      if (request.expiresAt.getTime() <= now.getTime()) {
        await tx.update(correctionRequests).set({ status: "EXPIRED", updatedAt: now }).where(eq(correctionRequests.id, request.id));
        return { outcome: "EXPIRED" as const, caseId: request.caseId };
      }
      const caseId = await applyCorrectionTx(tx, { id: request.id, caseId: request.caseId }, input);
      return { outcome: "APPLIED" as const, caseId };
    });
  }

  async getPendingCorrectionsForOrder(orderId: string) {
    return this.db.select({
      requestId: correctionRequests.id,
      caseId: correctionRequests.caseId,
      activeRunId: cases.activeRunId,
      expiresAt: correctionRequests.expiresAt,
      caseStatus: cases.status,
    }).from(correctionRequests)
      .innerJoin(cases, eq(cases.id, correctionRequests.caseId))
      .where(and(eq(cases.orderId, orderId), eq(correctionRequests.status, "PENDING")));
  }

  async recordInboundEvent(input: {
    providerMessageId: string;
    kind: "MESSAGE" | "STATUS";
    statusValue?: string;
    senderLookupHash?: string | null;
    resultCode?: string;
  }) {
    const [existing] = await this.db.select().from(whatsappInboundEvents)
      .where(eq(whatsappInboundEvents.providerMessageId, input.providerMessageId)).limit(1);
    if (existing) return { record: existing, created: false };
    try {
      const [record] = await this.db.insert(whatsappInboundEvents).values({
        providerMessageId: input.providerMessageId,
        kind: input.kind,
        statusValue: input.statusValue ?? null,
        senderLookupHash: input.senderLookupHash ?? null,
        resultCode: input.resultCode ?? "RECEIVED",
      }).returning();
      if (!record) throw new Error("Could not record inbound event");
      return { record, created: true };
    } catch {
      const [raced] = await this.db.select().from(whatsappInboundEvents)
        .where(eq(whatsappInboundEvents.providerMessageId, input.providerMessageId)).limit(1);
      if (raced) return { record: raced, created: false };
      throw new Error("Could not record inbound event");
    }
  }

  async updateInboundEventResult(
    id: string,
    patch: { resultCode: string; caseId?: string | null; correctionRequestId?: string | null; statusValue?: string | null },
  ) {
    const [record] = await this.db.update(whatsappInboundEvents).set({
      resultCode: patch.resultCode,
      caseId: patch.caseId ?? null,
      correctionRequestId: patch.correctionRequestId ?? null,
      statusValue: patch.statusValue ?? null,
      updatedAt: new Date(),
    }).where(eq(whatsappInboundEvents.id, id)).returning();
    if (!record) throw error(404, "WHATSAPP_INBOUND_NOT_FOUND", "The inbound event was not found.");
    return record;
  }

  async getWhatsappMessageByProviderId(providerMessageId: string) {
    const [row] = await this.db.select().from(whatsappMessages)
      .where(eq(whatsappMessages.providerMessageId, providerMessageId)).limit(1);
    return row ?? null;
  }

  async updateWhatsappMessageFromStatus(
    providerMessageId: string,
    next: "DELIVERED" | "READ" | "FAILED",
  ) {
    const [current] = await this.db.select({ id: whatsappMessages.id }).from(whatsappMessages)
      .where(eq(whatsappMessages.providerMessageId, providerMessageId)).limit(1);
    if (!current) return { applied: false as const, message: null };
    const allowedFrom =
      next === "READ"
        ? ["SENT", "DELIVERED", "NEEDS_REVIEW"]
        : ["PENDING", "SENT", "NEEDS_REVIEW"];
    const [updated] = await this.db.update(whatsappMessages).set({
      status: next,
      updatedAt: new Date(),
    }).where(and(
      eq(whatsappMessages.id, current.id),
      inArray(whatsappMessages.status, allowedFrom as Array<"PENDING" | "SENT" | "DELIVERED" | "NEEDS_REVIEW">),
    )).returning();
    if (!updated) {
      const [latest] = await this.db.select().from(whatsappMessages)
        .where(eq(whatsappMessages.id, current.id)).limit(1);
      return { applied: false as const, message: latest ?? null };
    }
    return { applied: true as const, message: updated };
  }

  async claimWhatsappSend(messageId: string) {
    const [claimed] = await this.db.update(whatsappMessages).set({
      status: "SENDING",
      attemptCount: sql`${whatsappMessages.attemptCount} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(whatsappMessages.id, messageId),
      inArray(whatsappMessages.status, ["PENDING", "RETRYABLE"]),
    )).returning();
    return claimed ?? null;
  }

  async finalizeWhatsappSend(
    messageId: string,
    result: {
      status: "SENT" | "FAILED" | "RETRYABLE" | "NEEDS_REVIEW";
      providerMessageId?: string;
      errorCode?: string;
    },
  ) {
    const [record] = await this.db.update(whatsappMessages).set({
      status: result.status,
      providerMessageId: result.providerMessageId ?? null,
      errorCode: result.errorCode ?? null,
      updatedAt: new Date(),
    }).where(and(
      eq(whatsappMessages.id, messageId),
      eq(whatsappMessages.status, "SENDING"),
    )).returning();
    if (!record) throw error(409, "WHATSAPP_SEND_NOT_CLAIMED", "The WhatsApp send is no longer owned by this worker.");
    return record;
  }

  async resolveWhatsappNeedsReview(
    messageId: string,
    resolution: { to: "PENDING" | "SENT"; providerMessageId?: string; errorCode?: string },
  ) {
    const [record] = await this.db.update(whatsappMessages).set({
      status: resolution.to,
      providerMessageId: resolution.providerMessageId ?? null,
      errorCode: resolution.errorCode ?? null,
      updatedAt: new Date(),
    }).where(and(
      eq(whatsappMessages.id, messageId),
      eq(whatsappMessages.status, "NEEDS_REVIEW"),
    )).returning();
    if (!record) throw error(409, "WHATSAPP_NOT_AWAITING_REVIEW", "The WhatsApp message is not awaiting review.");
    return record;
  }

  async decideApproval(
    caseId: string,
    approvalId: string,
    input: { decision: "approve" | "reject"; reason?: string; expectedVersion?: number },
  ): Promise<PublicCaseSnapshot> {
    await this.transaction(async (tx) => {
      const row = await lockCase(tx, caseId);
      checkExpectedVersion(row, input.expectedVersion);
      if (row.status !== "WAITING_APPROVAL" || !row.activeRunId) {
        throw error(409, "CASE_NOT_WAITING_FOR_APPROVAL", "The case is not waiting for merchant approval.");
      }
      const [approval] = await tx.select().from(approvals)
        .where(and(eq(approvals.id, approvalId), eq(approvals.caseId, caseId)))
        .for("update").limit(1);
      if (!approval) throw error(404, "APPROVAL_NOT_FOUND", "Approval was not found for this case.");
      if (approval.status !== "PENDING") throw error(409, "APPROVAL_ALREADY_REVIEWED", "This approval was already reviewed.");
      const now = new Date();
      const approved = input.decision === "approve";
      await tx.update(approvals).set({
        status: approved ? "APPROVED" : "REJECTED",
        reviewedBy: "demo-operator",
        reviewedAt: now,
        updatedAt: now,
      }).where(eq(approvals.id, approvalId));

      if (approved) {
        await transitionCaseTx(tx, row, {
          to: "BOOKING",
          actor: "merchant",
          type: "APPROVAL_GRANTED",
          payload: { title: "Shipping cost approved", summary: `The merchant approved the ${approval.requestedCostNgn.toLocaleString("en-NG")} NGN quote.`, station: "controller", nextAction: "Prepare an idempotent booking" },
        }, row.activeRunId);
        await tx.update(runs).set({ status: "RUNNING", updatedAt: now }).where(eq(runs.id, row.activeRunId));
        await insertJobTx(tx, {
          caseId,
          runId: row.activeRunId,
          step: "booking_prepare",
          dedupeKey: `${row.activeRunId}:booking_prepare:1`,
          payloadJson: { approvalId },
        });
      } else {
        await transitionCaseTx(tx, row, {
          to: "ESCALATED",
          actor: "merchant",
          type: "CASE_ESCALATED",
          payload: { title: "Approval declined", summary: input.reason ?? "The merchant declined the above-ceiling shipping quote.", station: "controller", nextAction: "Review the case manually" },
        }, row.activeRunId);
        await tx.update(runs).set({ status: "FAILED", finishedAt: now, updatedAt: now }).where(eq(runs.id, row.activeRunId));
      }
    });

    const snapshot = await this.getCaseSnapshot(caseId);
    if (!snapshot) throw error(404, "CASE_NOT_FOUND", "Case was not found.");
    return snapshot;
  }

  async claimJob(workerId: string, leaseMs: number): Promise<ClaimedJob | null> {
    if (!workerId.trim() || !Number.isInteger(leaseMs) || leaseMs < 1_000) {
      throw new RangeError("Job lease owner and duration must be valid.");
    }
    return this.transaction(async (tx) => {
      const now = new Date();
      const candidate = await tx.select().from(jobs)
        .where(or(
          and(eq(jobs.state, "READY"), lte(jobs.availableAt, now)),
          and(eq(jobs.state, "RUNNING"), lt(jobs.leaseUntil, now)),
        ))
        .orderBy(asc(jobs.availableAt), asc(jobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      const [job] = candidate;
      if (!job) return null;
      const [claimed] = await tx.update(jobs).set({
        state: "RUNNING",
        leaseOwner: workerId,
        leaseToken: randomUUID(),
        leaseUntil: new Date(now.getTime() + leaseMs),
        heartbeatAt: now,
        attempt: job.attempt + 1,
        updatedAt: now,
      }).where(eq(jobs.id, job.id)).returning();
      return claimed ? claimed as ClaimedJob : null;
    });
  }

  async heartbeatJob(jobId: string, workerId: string, leaseToken: string, leaseMs: number): Promise<void> {
    if (!workerId.trim() || !leaseToken || !Number.isInteger(leaseMs) || leaseMs < 1_000) {
      throw new RangeError("Job lease owner, token, and duration must be valid.");
    }
    const now = new Date();
    const updated = await this.db.update(jobs).set({
      heartbeatAt: now,
      leaseUntil: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    }).where(leaseWhere(jobId, workerId, leaseToken)).returning();
    if (updated.length === 0) throw error(409, "JOB_LEASE_LOST", "The worker lease is no longer current.");
  }

  async beginTask(job: Job, workerId: string, leaseToken: string, input: NewTaskInput): Promise<AgentTask> {
    return this.transaction(async (tx) => {
      const [lockedJob] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update").limit(1);
      requireCurrentLease(lockedJob, workerId, leaseToken);
      const [caseRow] = await tx.select().from(cases).where(eq(cases.id, lockedJob.caseId)).for("update").limit(1);
      if (!caseRow) throw error(404, "CASE_NOT_FOUND", "Case was not found.");
      const payload = objectValue(lockedJob.payloadJson);
      const existingTaskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
      let task: AgentTask | undefined;
      if (existingTaskId) {
        [task] = await tx.select().from(agentTasks).where(eq(agentTasks.id, existingTaskId)).for("update").limit(1);
      }
      if (!task) {
        [task] = await tx.insert(agentTasks).values({
          runId: input.runId,
          role: input.role,
          goal: input.goal.slice(0, 500),
          status: "RUNNING",
          inputJson: input.inputJson,
          startedAt: new Date(),
        }).returning();
        if (!task) throw new Error("Could not persist agent task");
        const updated = await tx.update(jobs).set({ payloadJson: { ...payload, taskId: task.id }, updatedAt: new Date() })
          .where(leaseWhere(job.id, workerId, leaseToken)).returning({ id: jobs.id });
        if (updated.length === 0) throw error(409, "JOB_LEASE_LOST", "The worker lease is no longer current.");
        await appendEventTx(tx, {
          caseId: caseRow.id,
          runId: lockedJob.runId,
          type: "TASK_DELEGATED",
          actor: "controller",
          taskId: task.id,
          payload: { title: "Task delegated", summary: input.goal.slice(0, 350), station: input.role },
        });
      } else {
        await tx.update(agentTasks).set({ status: "RUNNING", startedAt: task.startedAt ?? new Date(), updatedAt: new Date() }).where(eq(agentTasks.id, task.id));
      }
      await appendEventTx(tx, {
        caseId: caseRow.id,
        runId: lockedJob.runId,
        type: "AGENT_STARTED",
        actor: input.role,
        taskId: task.id,
        payload: { title: `${input.role} task started`, summary: input.goal.slice(0, 350), station: input.role },
      });
      return task;
    });
  }

  async commitJobStep(input: CommitJobStepInput): Promise<void> {
    await this.transaction(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, input.jobId)).for("update").limit(1);
      requireCurrentLease(job, input.workerId, input.leaseToken);
      const row = await lockCase(tx, job.caseId);
      const [task] = await tx.select().from(agentTasks).where(eq(agentTasks.id, input.taskId)).for("update").limit(1);
      if (!task) throw error(404, "TASK_NOT_FOUND", "Agent task was not found.");
      const now = new Date();
      await tx.update(agentTasks).set({
        status: input.taskStatus ?? "COMPLETED",
        outputJson: input.outputJson,
        finishedAt: now,
        updatedAt: now,
      }).where(eq(agentTasks.id, task.id));
      await appendEventTx(tx, {
        caseId: row.id,
        runId: job.runId,
        type: "AGENT_COMPLETED",
        actor: task.role,
        taskId: task.id,
        payload: {
          title: `${task.role} task ${input.taskStatus === "FAILED" ? "failed" : "completed"}`,
          summary: input.summary,
          station: task.role,
          ...(input.taskStatus === "FAILED" ? { resultCode: eventText(input.outputJson.resultCode, "STEP_FAILED") } : {}),
        },
      });

      if (input.pendingApproval) {
        const [existingApproval] = await tx.select().from(approvals)
          .where(and(eq(approvals.caseId, row.id), eq(approvals.status, "PENDING"))).for("update").limit(1);
        if (existingApproval) {
          if (existingApproval.quoteOptionId !== input.pendingApproval.quoteOptionId
            || existingApproval.proposalHash !== input.pendingApproval.proposalHash
            || existingApproval.requestedCostNgn !== input.pendingApproval.requestedCostNgn) {
            throw error(409, "APPROVAL_PROPOSAL_CONFLICT", "A different pending quote proposal already exists.");
          }
        } else {
          await tx.insert(approvals).values({
            caseId: row.id,
            quoteOptionId: input.pendingApproval.quoteOptionId,
            proposalHash: input.pendingApproval.proposalHash,
            requestedCostNgn: input.pendingApproval.requestedCostNgn,
            status: "PENDING",
          });
        }
      }

      let current = row;
      for (const transition of input.transitions ?? []) {
        current = await transitionCaseTx(tx, current, transition, job.runId);
      }
      for (const event of input.events ?? []) {
        await appendEventTx(tx, { caseId: row.id, runId: job.runId, taskId: event.taskId ?? task.id, ...event });
      }
      if (input.evidenceReceipt) {
        await tx.insert(evidenceReceipts).values({
          caseId: row.id,
          bookingId: input.evidenceReceipt.bookingId,
          result: input.evidenceReceipt.result,
          verificationJson: input.evidenceReceipt.verificationJson,
        });
      }
      const completed = await tx.update(jobs).set({
        state: "COMPLETED",
        completedAt: now,
        leaseOwner: null,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
      }).where(leaseWhere(job.id, input.workerId, input.leaseToken)).returning({ id: jobs.id });
      if (completed.length === 0) throw error(409, "JOB_LEASE_LOST", "The worker lease is no longer current.");
      if (input.runStatus) {
        await tx.update(runs).set({
          status: input.runStatus,
          ...(input.runStatus === "COMPLETED" || input.runStatus === "FAILED" ? { finishedAt: now } : {}),
          updatedAt: now,
        }).where(eq(runs.id, job.runId));
      }
      if (input.orderFulfillmentStatus) {
        await tx.update(orders).set({ fulfillmentStatus: input.orderFulfillmentStatus, updatedAt: now }).where(eq(orders.id, row.orderId));
      }
      if (input.nextStep && input.taskStatus !== "FAILED") {
        await insertJobTx(tx, {
          caseId: job.caseId,
          runId: job.runId,
          step: input.nextStep,
          dedupeKey: `${job.runId}:${input.nextStep}:1`,
          payloadJson: input.nextPayload,
        });
      }
    });
  }

  async setRunTraceRef(runId: string, traceRef?: string): Promise<void> {
    if (!traceRef || !/^[0-9a-f]{32}$/i.test(traceRef)) return;
    await this.db.update(runs).set({ traceRef, updatedAt: new Date() }).where(eq(runs.id, runId));
  }

  async failClaimedJob(jobId: string, workerId: string, leaseToken: string, resultCode = "STEP_EXECUTION_FAILED"): Promise<void> {
    await this.transaction(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update").limit(1);
      requireCurrentLease(job, workerId, leaseToken);
      const row = await lockCase(tx, job.caseId);
      const payload = objectValue(job.payloadJson);
      const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
      if (taskId) {
        const [task] = await tx.select().from(agentTasks).where(eq(agentTasks.id, taskId)).for("update").limit(1);
        if (task) {
          await tx.update(agentTasks).set({
            status: "FAILED",
            outputJson: { resultCode: resultCode.slice(0, 80) },
            finishedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(agentTasks.id, task.id));
          await appendEventTx(tx, {
            caseId: row.id,
            runId: job.runId,
            type: "AGENT_COMPLETED",
            actor: task.role,
            taskId: task.id,
            payload: { title: `${task.role} task failed`, summary: "The bounded workflow step could not complete safely.", resultCode: resultCode.slice(0, 80), station: task.role },
          });
        }
      }
      if (!["CANCELLED", "RESOLVED", "ESCALATED"].includes(row.status)) {
        await transitionCaseTx(tx, row, {
          to: "ESCALATED",
          actor: "system",
          type: "CASE_ESCALATED",
          payload: { title: "Case paused for review", summary: "A workflow step stopped safely and needs operator review.", resultCode: resultCode.slice(0, 80), station: "controller", nextAction: "Review the case before resuming" },
        }, job.runId);
      }
      const failed = await tx.update(jobs).set({ state: "DEAD", lastErrorCode: resultCode.slice(0, 120), leaseOwner: null, leaseToken: null, leaseUntil: null, completedAt: new Date(), updatedAt: new Date() })
        .where(leaseWhere(job.id, workerId, leaseToken)).returning({ id: jobs.id });
      if (failed.length === 0) throw error(409, "JOB_LEASE_LOST", "The worker lease is no longer current.");
      await tx.update(runs).set({ status: "FAILED", finishedAt: new Date(), updatedAt: new Date() }).where(eq(runs.id, job.runId));
    });
  }

  async recordQuoteAttempt(input: {
    caseId: string;
    runId: string;
    taskId: string;
    route: "PREFERRED" | "ALTERNATIVE";
    status: "STARTED" | "SUCCEEDED" | "FAILED";
    attempt: number;
    resultCode?: string;
    latencyMs?: number;
    safeResultJson?: Record<string, unknown>;
  }): Promise<string> {
    const [existing] = await this.db.select().from(quoteAttempts).where(and(
      eq(quoteAttempts.caseId, input.caseId),
      eq(quoteAttempts.route, input.route),
      eq(quoteAttempts.attempt, input.attempt),
    )).limit(1);
    if (existing) {
      await this.db.update(quoteAttempts).set({
        taskId: input.taskId,
        status: input.status,
        resultCode: input.resultCode,
        latencyMs: input.latencyMs,
        safeResultJson: input.safeResultJson,
        finishedAt: input.status === "STARTED" ? null : new Date(),
        updatedAt: new Date(),
      }).where(eq(quoteAttempts.id, existing.id));
      return existing.id;
    }
    const [record] = await this.db.insert(quoteAttempts).values({
      caseId: input.caseId,
      runId: input.runId,
      taskId: input.taskId,
      route: input.route,
      provider: input.route === "PREFERRED" ? "GIG_LOGISTICS" : "REDSTAR_EXPRESS",
      attempt: input.attempt,
      status: input.status,
      resultCode: input.resultCode,
      latencyMs: input.latencyMs,
      safeResultJson: input.safeResultJson,
      ...(input.status === "STARTED" ? {} : { finishedAt: new Date() }),
    }).returning();
    if (!record) throw new Error("Could not persist quote attempt");
    return record.id;
  }

  async recordToolAttempt(input: {
    taskId: string;
    tool: string;
    attempt: number;
    status: "STARTED" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
    resultCode?: string;
    latencyMs?: number;
    safeResultJson?: Record<string, unknown>;
  }): Promise<void> {
    const [existing] = await this.db.select().from(toolAttempts).where(and(
      eq(toolAttempts.taskId, input.taskId),
      eq(toolAttempts.tool, input.tool),
      eq(toolAttempts.attempt, input.attempt),
    )).limit(1);
    const values = {
      status: input.status,
      resultCode: input.resultCode,
      latencyMs: input.latencyMs,
      safeResultJson: input.safeResultJson,
      finishedAt: input.status === "STARTED" ? null : new Date(),
      updatedAt: new Date(),
    };
    if (existing) {
      await this.db.update(toolAttempts).set(values).where(eq(toolAttempts.id, existing.id));
      return;
    }
    await this.db.insert(toolAttempts).values({
      taskId: input.taskId,
      tool: input.tool,
      attempt: input.attempt,
      ...values,
      ...(input.status === "STARTED" ? {} : { startedAt: new Date() }),
    });
  }

  async persistEvidenceAndResolve(input: {
    caseId: string;
    runId: string;
    bookingId: string;
    result: "PASS" | "FAIL";
    verificationJson: Record<string, unknown>;
  }): Promise<void> {
    await this.transaction(async (tx) => {
      const row = await lockCase(tx, input.caseId);
      if (row.status !== "VERIFYING") throw error(409, "CASE_NOT_VERIFYING", "Evidence can only close a verifying case.");
      await tx.insert(evidenceReceipts).values({
        caseId: input.caseId,
        bookingId: input.bookingId,
        verificationJson: input.verificationJson,
        result: input.result,
      });
      if (input.result === "PASS") {
        const verified = await transitionCaseTx(tx, row, {
          to: "RESOLVED",
          verificationResult: "PASS",
          actor: "verifier",
          type: "VERIFICATION_PASSED",
          payload: { title: "Booking independently verified", summary: "A fresh sandbox readback matched the saved booking intent and approved order details.", station: "verifier", resultCode: "PASS", nextAction: "Review the verification receipt" },
        }, input.runId);
        await appendEventTx(tx, {
          caseId: input.caseId,
          runId: input.runId,
          type: "CASE_RESOLVED",
          actor: "controller",
          payload: { title: "Case resolved", summary: "The booking was verified and recorded. Delivery is not claimed.", station: "controller", resultCode: "VERIFIED_BOOKING" },
        });
        await tx.update(orders).set({ fulfillmentStatus: "BOOKED", updatedAt: new Date() }).where(eq(orders.id, verified.orderId));
        await tx.update(runs).set({ status: "COMPLETED", finishedAt: new Date(), updatedAt: new Date() }).where(eq(runs.id, input.runId));
      } else {
        const escalated = await transitionCaseTx(tx, row, {
          to: "ESCALATED",
          actor: "verifier",
          type: "VERIFICATION_FAILED",
          payload: { title: "Booking verification failed", summary: "A fresh provider readback did not match the saved booking intent.", station: "verifier", resultCode: "VERIFICATION_MISMATCH", nextAction: "Review the mismatch before any further booking action" },
        }, input.runId);
        await appendEventTx(tx, {
          caseId: input.caseId,
          runId: input.runId,
          type: "CASE_ESCALATED",
          actor: "controller",
          payload: { title: "Case needs review", summary: "The booking remains unverified and requires manual review.", station: "controller" },
        });
        await tx.update(runs).set({ status: "FAILED", finishedAt: new Date(), updatedAt: new Date() }).where(eq(runs.id, input.runId));
        await tx.update(orders).set({ fulfillmentStatus: "BLOCKED", updatedAt: new Date() }).where(eq(orders.id, escalated.orderId));
      }
    });
  }

  async markBookingSubmitted(idempotencyKey: string): Promise<void> {
    await this.transaction(async (tx) => {
      const [intent] = await tx.select().from(bookingIntents).where(eq(bookingIntents.idempotencyKey, idempotencyKey)).for("update").limit(1);
      if (!intent) throw error(404, "BOOKING_INTENT_NOT_FOUND", "Booking intent was not found.");
      if (intent.status !== "PREPARED") return;
      await tx.update(bookingIntents).set({ status: "SUBMITTED", submittedAt: new Date(), updatedAt: new Date() }).where(eq(bookingIntents.id, intent.id));
    });
  }

  async getCaseWorkflowContext(caseId: string): Promise<{
    caseRecord: CaseRecord;
    order: typeof orders.$inferSelect;
    merchant: typeof merchants.$inferSelect;
    run: Run;
  } | null> {
    const [row] = await this.db.select({ caseRecord: cases, order: orders, merchant: merchants, run: runs })
      .from(cases)
      .innerJoin(orders, eq(cases.orderId, orders.id))
      .innerJoin(merchants, eq(orders.merchantId, merchants.id))
      .innerJoin(runs, eq(cases.activeRunId, runs.id))
      .where(eq(cases.id, caseId)).limit(1);
    return row ?? null;
  }

  async getQuoteRow(quoteId: string) {
    const [row] = await this.db.select().from(quoteOptions).where(eq(quoteOptions.id, quoteId)).limit(1);
    return row ?? null;
  }

  async getLatestFailedQuoteAttempt(caseId: string, runId: string) {
    const [row] = await this.db.select().from(quoteAttempts)
      .where(and(eq(quoteAttempts.caseId, caseId), eq(quoteAttempts.runId, runId), eq(quoteAttempts.status, "FAILED")))
      .orderBy(desc(quoteAttempts.createdAt)).limit(1);
    return row ?? null;
  }

  async getPendingBookingContext(caseId: string) {
    const [row] = await this.db.select({ intent: bookingIntents, booking: bookings, quote: quoteOptions, approval: approvals })
      .from(bookingIntents)
      .innerJoin(bookings, eq(bookings.bookingIntentId, bookingIntents.id))
      .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
      .leftJoin(approvals, eq(bookingIntents.approvalId, approvals.id))
      .where(eq(bookingIntents.caseId, caseId))
      .orderBy(desc(bookingIntents.createdAt))
      .limit(1);
    return row ?? null;
  }

  async countBookingsByIdempotencyKey(idempotencyKey: string): Promise<number> {
    const rows = await this.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.idempotencyKey, idempotencyKey));
    return rows.length;
  }

  async countActiveBookings(caseId: string): Promise<number> {
    const rows = await this.db.select({ id: bookings.id }).from(bookings)
      .where(and(eq(bookings.caseId, caseId), inArray(bookings.state, ["PENDING", "BOOKED", "UNKNOWN"])));
    return rows.length;
  }

  async countProviderBookingId(providerBookingId: string): Promise<number> {
    const rows = await this.db.select({ id: bookings.id }).from(bookings)
      .where(eq(bookings.providerBookingId, providerBookingId));
    return rows.length;
  }

  async verifyBookingAgain(caseId: string): Promise<{ result: "PASS" | "FAIL"; checks: Record<string, boolean> }> {
    const persisted = await this.getBookingForReadback(caseId);
    if (!persisted?.booking.providerBookingId) {
      return { result: "FAIL", checks: { bookingIdentity: false, order: false, status: false, courier: false, price: false, uniqueness: false } };
    }
    const readback = await this.getBookingByProviderBookingId(persisted.booking.providerBookingId);
    const count = await this.countProviderBookingId(persisted.booking.providerBookingId);
    const checks = {
      bookingIdentity: readback?.providerBookingId === persisted.booking.providerBookingId,
      order: readback?.orderId === persisted.intent.orderId && readback?.caseId === caseId,
      status: readback?.status === "BOOKED" && persisted.booking.state === "BOOKED",
      courier: readback?.providerCode === persisted.quote.provider && persisted.booking.provider === persisted.quote.provider,
      price: readback?.amountNgn === persisted.quote.amountNgn && persisted.booking.costNgn === persisted.quote.amountNgn,
      uniqueness: count === 1 && persisted.booking.idempotencyKey === persisted.intent.idempotencyKey,
    };
    return {
      result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      checks,
    };
  }

  async getBookingForReadback(caseId: string) {
    const [row] = await this.db.select({ booking: bookings, intent: bookingIntents, quote: quoteOptions })
      .from(bookings)
      .innerJoin(bookingIntents, eq(bookings.bookingIntentId, bookingIntents.id))
      .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
      .where(eq(bookings.caseId, caseId))
      .orderBy(desc(bookings.createdAt))
      .limit(1);
    return row ?? null;
  }

  async getApprovalForCase(caseId: string) {
    const [row] = await this.db.select({ approval: approvals, quote: quoteOptions })
      .from(approvals)
      .leftJoin(quoteOptions, eq(approvals.quoteOptionId, quoteOptions.id))
      .where(and(eq(approvals.caseId, caseId), eq(approvals.status, "PENDING")))
      .limit(1);
    return row ?? null;
  }

  async getCorrectionRequestForCase(caseId: string) {
    const [row] = await this.db.select().from(correctionRequests)
      .where(and(eq(correctionRequests.caseId, caseId), eq(correctionRequests.status, "PENDING")))
      .orderBy(desc(correctionRequests.createdAt)).limit(1);
    return row ?? null;
  }

  async getWhatsappMessageByIdempotencyKey(idempotencyKey: string) {
    const [row] = await this.db.select().from(whatsappMessages)
      .where(eq(whatsappMessages.idempotencyKey, idempotencyKey)).limit(1);
    return row ?? null;
  }

  async insertWhatsappMessagePending(input: {
    caseId: string;
    correctionRequestId: string;
    idempotencyKey: string;
    templateName: string;
    templateLanguage: string;
    recipientHash: string;
  }) {
    const existing = await this.getWhatsappMessageByIdempotencyKey(input.idempotencyKey);
    if (existing) return { record: existing, created: false };
    try {
      const [record] = await this.db.insert(whatsappMessages).values({
        caseId: input.caseId,
        correctionRequestId: input.correctionRequestId,
        idempotencyKey: input.idempotencyKey,
        templateName: input.templateName,
        templateLanguage: input.templateLanguage,
        recipientHash: input.recipientHash,
        status: "PENDING",
        attemptCount: 0,
      }).returning();
      if (!record) throw new Error("Could not record WhatsApp message");
      return { record, created: true };
    } catch {
      const raced = await this.getWhatsappMessageByIdempotencyKey(input.idempotencyKey);
      if (raced) return { record: raced, created: false };
      throw new Error("Could not record WhatsApp message");
    }
  }

  async updateWhatsappMessageStatus(
    id: string,
    patch: {
      status: "SENT" | "FAILED" | "RETRYABLE" | "NEEDS_REVIEW" | "SKIPPED";
      providerMessageId?: string;
      errorCode?: string;
    },
  ) {
    const [record] = await this.db.update(whatsappMessages).set({
      status: patch.status,
      providerMessageId: patch.providerMessageId ?? null,
      errorCode: patch.errorCode ?? null,
      attemptCount: sql`${whatsappMessages.attemptCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(whatsappMessages.id, id)).returning();
    if (!record) throw error(404, "WHATSAPP_MESSAGE_NOT_FOUND", "The WhatsApp message was not found.");
    return record;
  }

  async updateBookingOutcome(input: {
    bookingIntentId: string;
    bookingId: string;
    status: "CONFIRMED" | "UNKNOWN" | "FAILED";
    providerBookingId?: string;
  }): Promise<void> {
    const now = new Date();
    await this.transaction(async (tx) => {
      await tx.update(bookingIntents).set({
        status: input.status,
        providerBookingId: input.providerBookingId,
        outcomeCode: input.status,
        updatedAt: now,
      }).where(eq(bookingIntents.id, input.bookingIntentId));
      await tx.update(bookings).set({
        state: input.status === "CONFIRMED" ? "BOOKED" : input.status,
        providerBookingId: input.providerBookingId,
        bookedAt: input.status === "CONFIRMED" ? now : null,
        updatedAt: now,
      }).where(eq(bookings.id, input.bookingId));
    });
  }

  async prepareBooking(input: BookingRequest & { idempotencyKey: string; approvalId?: string }): Promise<BookingIntent> {
    const quote = await this.getQuote(input.quoteId);
    if (!quote) throw error(404, "QUOTE_NOT_FOUND", "The selected quote was not found.");
    const intent: BookingIntent = {
      caseId: input.caseId,
      orderId: input.orderId,
      quoteId: input.quoteId,
      idempotencyKey: input.idempotencyKey,
      mode: "DEMO_SANDBOX",
      providerReference: `NENTRA-SBX-${sha256(input.idempotencyKey).toUpperCase()}`,
    };
    return this.persistBookingIntent(intent, input.approvalId);
  }

  async getBookingIntent(idempotencyKey: string) {
    const [row] = await this.db.select({ intent: bookingIntents, booking: bookings, quote: quoteOptions })
      .from(bookingIntents)
      .innerJoin(bookings, eq(bookings.bookingIntentId, bookingIntents.id))
      .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
      .where(eq(bookingIntents.idempotencyKey, idempotencyKey)).limit(1);
    return row ?? null;
  }

  async getFault(caseId: string, tool: string) {
    const [row] = await this.db.select().from(demoFaults).where(and(eq(demoFaults.caseId, caseId), eq(demoFaults.tool, tool))).limit(1);
    return row ?? null;
  }

  async resetAndSeed(input: { correctionToken: string; now?: Date }): Promise<{
    caseId: string;
    orderId: string;
    merchantId: string;
    correctionToken: string;
  }> {
    const now = input.now ?? new Date();
    return this.transaction(async (tx) => {
      const [existingMerchant] = await tx.select().from(merchants).where(eq(merchants.name, DEMO_MERCHANT_NAME)).limit(1);
      if (existingMerchant) {
        await tx.delete(cases).where(eq(cases.orderId, DEMO_ORDER_ID));
        await tx.delete(orders).where(eq(orders.id, DEMO_ORDER_ID));
        await tx.delete(merchants).where(eq(merchants.id, existingMerchant.id));
      }
      const [merchant] = await tx.insert(merchants).values({
        id: DEMO_MERCHANT_ID,
        name: DEMO_MERCHANT_NAME,
        currency: "NGN",
        maxShippingNgn: 6_500,
        mode: "DEMO_SANDBOX",
      }).returning();
      if (!merchant) throw new Error("Could not seed the demo merchant");
      const [order] = await tx.insert(orders).values({
        id: DEMO_ORDER_ID,
        merchantId: merchant.id,
        orderNumber: DEMO_ORDER_NUMBER,
        amountNgn: 65_000,
        paymentStatus: "PAID",
        addressJson: {
          recipientName: "A fictional demo recipient",
          phone: "+2348012345678",
          addressLine1: "12 Fictional Commerce Road",
          area: "Lekki",
          city: "Lagos",
          state: "Lagos",
          countryCode: "NG",
        },
        fulfillmentStatus: "BLOCKED",
      }).returning();
      if (!order) throw new Error("Could not seed the demo order");
      const [caseRecord] = await tx.insert(cases).values({
        id: DEMO_CASE_ID,
        orderId: order.id,
        status: "NEW",
        blocker: "ADDRESS_INCOMPLETE",
      }).returning();
      if (!caseRecord) throw new Error("Could not seed the demo case");
      await tx.insert(demoFaults).values({
        caseId: caseRecord.id,
        tool: "quote_primary",
        remainingFailures: 1,
        errorCode: "PROVIDER_503",
      });
      await tx.insert(correctionRequests).values({
        caseId: caseRecord.id,
        tokenHash: sha256(input.correctionToken),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        status: "PENDING",
      });
      return {
        caseId: caseRecord.id,
        orderId: order.id,
        merchantId: merchant.id,
        correctionToken: input.correctionToken,
      };
    });
  }

  // ShippingStore methods below keep quote credentials and raw provider data server-side.
  async consumeFault(input: { caseId: string; tool: "quote_primary" }) {
    const [fault] = await this.db.update(demoFaults).set({
      remainingFailures: sql`${demoFaults.remainingFailures} - 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(demoFaults.caseId, input.caseId),
      eq(demoFaults.tool, input.tool),
      gte(demoFaults.remainingFailures, 1),
    )).returning();
    if (!fault) return null;
    return { id: fault.id, code: "PROVIDER_503" as const, providerCode: "GIG_LOGISTICS" };
  }

  async saveQuotes(quotes: readonly ShippingQuote[]): Promise<void> {
    if (quotes.length === 0) return;
    await this.db.insert(quoteOptions).values(await Promise.all(quotes.map(async (quote) => {
      const [attempt] = await this.db.select({ id: quoteAttempts.id }).from(quoteAttempts).where(and(
        eq(quoteAttempts.caseId, quote.caseId),
        eq(quoteAttempts.route, quote.route),
        eq(quoteAttempts.status, "STARTED"),
      )).orderBy(desc(quoteAttempts.createdAt)).limit(1);
      return {
        id: quote.id,
        caseId: quote.caseId,
        runId: (await this.getCaseWorkflowContext(quote.caseId))?.run.id ?? "",
        quoteAttemptId: attempt?.id ?? null,
        provider: quote.providerCode,
        service: quote.serviceCode,
        amountNgn: quote.amountNgn,
        eligible: quote.eligible,
        expiresAt: new Date(quote.expiresAt),
        quoteToken: null,
      };
    })));
  }

  async getQuote(quoteId: string): Promise<ShippingQuote | null> {
    const [row] = await this.db.select({ quote: quoteOptions, attempt: quoteAttempts })
      .from(quoteOptions)
      .leftJoin(quoteAttempts, eq(quoteOptions.quoteAttemptId, quoteAttempts.id))
      .where(eq(quoteOptions.id, quoteId)).limit(1);
    if (!row) return null;
    const [context] = await this.db.select({ orderId: orders.id })
      .from(cases).innerJoin(orders, eq(cases.orderId, orders.id)).where(eq(cases.id, row.quote.caseId)).limit(1);
    if (!context) return null;
    return {
      id: row.quote.id,
      mode: "DEMO_SANDBOX",
      caseId: row.quote.caseId,
      orderId: context.orderId,
      route: row.attempt?.route ?? (row.quote.provider === "GIG_LOGISTICS" ? "PREFERRED" : "ALTERNATIVE"),
      providerCode: row.quote.provider,
      serviceCode: row.quote.service,
      currency: "NGN",
      amountNgn: row.quote.amountNgn,
      eligible: row.quote.eligible as true,
      requiresApproval: row.quote.amountNgn > ((await this.getCaseSnapshot(row.quote.caseId))?.merchant.maxShippingNgn ?? 0),
      expiresAt: row.quote.expiresAt?.toISOString() ?? new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async persistBookingIntent(intent: BookingIntent, approvalId?: string): Promise<BookingIntent> {
    return this.transaction(async (tx) => {
      const [existing] = await tx.select({ intent: bookingIntents, quote: quoteOptions, booking: bookings })
        .from(bookingIntents)
        .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
        .innerJoin(bookings, eq(bookings.bookingIntentId, bookingIntents.id))
        .where(eq(bookingIntents.idempotencyKey, intent.idempotencyKey)).limit(1);
      if (existing) {
        if (existing.intent.caseId !== intent.caseId || existing.intent.orderId !== intent.orderId || existing.quote.id !== intent.quoteId) {
          throw error(409, "IDEMPOTENCY_CONFLICT", "The idempotency key is bound to a different booking.");
        }
        return mapBookingIntent(existing.intent);
      }
      const [quote] = await tx.select().from(quoteOptions).where(eq(quoteOptions.id, intent.quoteId)).limit(1);
      if (!quote || quote.caseId !== intent.caseId) throw error(404, "QUOTE_NOT_FOUND", "The persisted quote does not belong to this case.");
      const [caseAndOrder] = await tx.select({ caseRecord: cases, order: orders }).from(cases)
        .innerJoin(orders, eq(cases.orderId, orders.id)).where(eq(cases.id, intent.caseId)).limit(1);
      if (!caseAndOrder || caseAndOrder.order.id !== intent.orderId) throw error(409, "BOOKING_ORDER_MISMATCH", "Booking order does not match the case.");
      const [record] = await tx.insert(bookingIntents).values({
        caseId: intent.caseId,
        orderId: intent.orderId,
        quoteOptionId: intent.quoteId,
        approvalId,
        idempotencyKey: intent.idempotencyKey,
        mode: intent.mode,
        status: "PREPARED",
        requestJson: {
          caseId: intent.caseId,
          orderId: intent.orderId,
          quoteId: intent.quoteId,
          providerReference: intent.providerReference,
          provider: quote.provider,
          service: quote.service,
          amountNgn: quote.amountNgn,
          currency: "NGN",
        },
        providerBookingId: null,
      }).returning();
      if (!record) throw new Error("Could not persist the booking intent");
      await tx.insert(bookings).values({
        caseId: intent.caseId,
        orderId: intent.orderId,
        bookingIntentId: record.id,
        idempotencyKey: intent.idempotencyKey,
        provider: quote.provider,
        providerReference: intent.providerReference,
        state: "PENDING",
        mode: intent.mode,
        costNgn: quote.amountNgn,
      });
      return mapBookingIntent(record);
    });
  }

  async getBookingByIdempotencyKey(idempotencyKey: string): Promise<SandboxBooking | null> {
    const [row] = await this.db.select({ intent: bookingIntents, booking: bookings, quote: quoteOptions })
      .from(bookings)
      .innerJoin(bookingIntents, eq(bookings.bookingIntentId, bookingIntents.id))
      .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
      .where(and(eq(bookings.idempotencyKey, idempotencyKey), eq(bookings.state, "BOOKED"))).limit(1);
    return row ? mapSandboxBooking(row.intent, row.booking, row.quote) : null;
  }

  async createSandboxBooking(booking: SandboxBooking): Promise<SandboxBooking> {
    return this.transaction(async (tx) => {
      const [existing] = await tx.select({ intent: bookingIntents, bookingRecord: bookings, quote: quoteOptions })
        .from(bookings)
        .innerJoin(bookingIntents, eq(bookings.bookingIntentId, bookingIntents.id))
        .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
        .where(eq(bookings.idempotencyKey, booking.idempotencyKey)).for("update").limit(1);
      if (existing?.bookingRecord.state === "BOOKED") return mapSandboxBooking(existing.intent, existing.bookingRecord, existing.quote);
      if (!existing) {
        // ShippingStore also supports direct adapter use. The adapter always writes an intent first.
        throw error(409, "BOOKING_INTENT_REQUIRED", "A persisted booking intent is required before the provider write.");
      }
      if (existing.intent.caseId !== booking.caseId || existing.intent.orderId !== booking.orderId || existing.intent.quoteOptionId !== booking.quoteId) {
        throw error(409, "IDEMPOTENCY_CONFLICT", "The idempotency key is bound to a different booking.");
      }
      const now = new Date(booking.createdAt);
      await tx.update(bookingIntents).set({
        status: "CONFIRMED",
        providerBookingId: booking.providerBookingId,
        outcomeCode: "BOOKED",
        updatedAt: now,
      }).where(eq(bookingIntents.id, existing.intent.id));
      const [saved] = await tx.update(bookings).set({
        providerBookingId: booking.providerBookingId,
        state: "BOOKED",
        bookedAt: now,
        updatedAt: now,
      }).where(eq(bookings.id, existing.bookingRecord.id)).returning();
      if (!saved) throw new Error("Could not persist sandbox booking");
      return mapSandboxBooking(existing.intent, saved, existing.quote);
    });
  }

  async getBookingByProviderReference(providerReference: string): Promise<SandboxBooking | null> {
    const [row] = await this.db.select({ intent: bookingIntents, booking: bookings, quote: quoteOptions })
      .from(bookings)
      .innerJoin(bookingIntents, eq(bookings.bookingIntentId, bookingIntents.id))
      .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
      .where(and(eq(bookings.providerReference, providerReference), eq(bookings.state, "BOOKED"))).limit(1);
    return row ? mapSandboxBooking(row.intent, row.booking, row.quote) : null;
  }

  async getBookingByProviderBookingId(providerBookingId: string): Promise<SandboxBooking | null> {
    const [row] = await this.db.select({ intent: bookingIntents, booking: bookings, quote: quoteOptions })
      .from(bookings)
      .innerJoin(bookingIntents, eq(bookings.bookingIntentId, bookingIntents.id))
      .innerJoin(quoteOptions, eq(bookingIntents.quoteOptionId, quoteOptions.id))
      .where(and(eq(bookings.providerBookingId, providerBookingId), eq(bookings.state, "BOOKED"))).limit(1);
    return row ? mapSandboxBooking(row.intent, row.booking, row.quote) : null;
  }
}

export async function appendEventTx(
  tx: RepositoryTransaction,
  input: {
    caseId: string;
    runId: string;
    type: CaseEventType;
    actor: CaseEventActor;
    taskId?: string;
    payload: Record<string, unknown>;
  },
): Promise<CaseEventRecord> {
  const [current] = await tx.update(cases).set({
    lastEventSeq: sql`${cases.lastEventSeq} + 1`,
    updatedAt: new Date(),
  }).where(eq(cases.id, input.caseId)).returning({ lastEventSeq: cases.lastEventSeq });
  if (!current) throw error(404, "CASE_NOT_FOUND", "Case was not found.");
  const [event] = await tx.insert(caseEvents).values({
    caseId: input.caseId,
    runId: input.runId,
    seq: current.lastEventSeq,
    type: input.type,
    actor: input.actor,
    taskId: input.taskId,
    publicPayload: safePublicPayload(input.payload),
  }).returning();
  if (!event) throw new Error("Could not append case event");
  return event;
}

export async function transitionCaseTx(
  tx: RepositoryTransaction,
  current: CaseRecord,
  transition: CaseTransition,
  runId: string,
): Promise<CaseRecord> {
  transitionCaseStatus(current.status, transition.to, { verificationResult: transition.verificationResult });
  const [updated] = await tx.update(cases).set({
    status: transition.to,
    version: sql`${cases.version} + 1`,
    updatedAt: new Date(),
  }).where(and(eq(cases.id, current.id), eq(cases.version, current.version))).returning();
  if (!updated) throw error(409, "CASE_VERSION_CONFLICT", "The case changed before its transition could be saved.");
  await appendEventTx(tx, {
    caseId: current.id,
    runId,
    type: transition.type,
    actor: transition.actor,
    payload: transition.payload,
  });
  return updated;
}

export async function insertJobTx(
  tx: RepositoryTransaction,
  input: {
    caseId: string;
    runId: string;
    step: string;
    dedupeKey: string;
    payloadJson?: Record<string, unknown>;
    availableAt?: Date;
  },
): Promise<Job> {
  const [existing] = await tx.select().from(jobs).where(eq(jobs.dedupeKey, input.dedupeKey)).limit(1);
  if (existing) return existing;
  const [job] = await tx.insert(jobs).values({
    caseId: input.caseId,
    runId: input.runId,
    step: input.step,
    state: "READY",
    dedupeKey: input.dedupeKey,
    payloadJson: input.payloadJson,
    availableAt: input.availableAt ?? new Date(),
  }).returning();
  if (!job) throw new Error("Could not schedule workflow job");
  return job;
}

export async function lockCase(tx: RepositoryTransaction, caseId: string): Promise<CaseRecord> {
  const [row] = await tx.select().from(cases).where(eq(cases.id, caseId)).for("update").limit(1);
  if (!row) throw error(404, "CASE_NOT_FOUND", "Case was not found.");
  return row;
}

function checkExpectedVersion(row: CaseRecord, expectedVersion?: number): void {
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw error(409, "CASE_VERSION_CONFLICT", "The case changed before this action was accepted.");
  }
}

function toPublicEvent(row: CaseEventRecord): PublicCaseEvent {
  return sanitizeCaseEvent({
    id: row.id,
    caseId: row.caseId,
    runId: row.runId,
    seq: row.seq,
    type: row.type,
    actor: row.actor,
    taskId: row.taskId ?? undefined,
    payload: row.publicPayload,
    occurredAt: row.occurredAt.toISOString(),
  });
}

function mapBookingIntent(intent: typeof bookingIntents.$inferSelect): BookingIntent {
  const request = objectValue(intent.requestJson);
  return {
    caseId: intent.caseId,
    orderId: intent.orderId,
    quoteId: intent.quoteOptionId,
    idempotencyKey: intent.idempotencyKey,
    mode: intent.mode as "DEMO_SANDBOX",
    providerReference: typeof request.providerReference === "string" ? request.providerReference : `NENTRA-SBX-${sha256(intent.idempotencyKey).toUpperCase()}`,
  };
}

function mapSandboxBooking(
  intent: typeof bookingIntents.$inferSelect,
  booking: typeof bookings.$inferSelect,
  quote: typeof quoteOptions.$inferSelect,
): SandboxBooking {
  const mappedIntent = mapBookingIntent(intent);
  return {
    ...mappedIntent,
    providerBookingId: booking.providerBookingId ?? "",
    status: "BOOKED",
    amountNgn: booking.costNgn,
    currency: "NGN",
    providerCode: quote.provider,
    serviceCode: quote.service,
    createdAt: booking.bookedAt?.toISOString() ?? booking.createdAt.toISOString(),
  };
}
