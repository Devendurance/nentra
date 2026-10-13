import {
  AnyPgColumn,
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const shippingModeEnum = pgEnum("shipping_mode", [
  "DEMO_SANDBOX",
  "SHIPBUBBLE_TEST",
  "LIVE",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "PAID",
  "UNPAID",
  "UNKNOWN",
]);
export const fulfillmentStatusEnum = pgEnum("fulfillment_status", [
  "BLOCKED",
  "READY",
  "BOOKED",
  "CANCELLED",
]);
export const caseStatusEnum = pgEnum("case_status", [
  "NEW",
  "TRIAGING",
  "WAITING_CUSTOMER",
  "QUOTING",
  "RECOVERING",
  "WAITING_APPROVAL",
  "BOOKING",
  "VERIFYING",
  "RESOLVED",
  "ESCALATED",
  "CANCELLED",
]);
export const runStatusEnum = pgEnum("run_status", [
  "QUEUED",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export const taskRoleEnum = pgEnum("task_role", [
  "controller",
  "investigator",
  "liaison",
  "fulfillment",
  "recovery",
  "verifier",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "QUEUED",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export const eventActorEnum = pgEnum("event_actor", [
  "controller",
  "investigator",
  "liaison",
  "fulfillment",
  "recovery",
  "verifier",
  "system",
  "customer",
  "merchant",
]);
export const caseEventTypeEnum = pgEnum("case_event_type", [
  "CASE_STARTED",
  "PLAN_CREATED",
  "TASK_DELEGATED",
  "AGENT_STARTED",
  "AGENT_COMPLETED",
  "TOOL_CALLED",
  "TOOL_FAILED",
  "RETRY_SCHEDULED",
  "FALLBACK_SELECTED",
  "CUSTOMER_INPUT_REQUIRED",
  "CUSTOMER_INPUT_RECEIVED",
  "APPROVAL_REQUIRED",
  "APPROVAL_GRANTED",
  "BOOKING_CREATED",
  "VERIFICATION_STARTED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "CASE_ESCALATED",
  "CASE_RESOLVED",
]);
export const attemptStatusEnum = pgEnum("attempt_status", [
  "STARTED",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
]);
export const correctionStatusEnum = pgEnum("correction_status", [
  "PENDING",
  "COMPLETED",
  "EXPIRED",
  "REVOKED",
]);
export const whatsappMessageStatusEnum = pgEnum("whatsapp_message_status", [
  "PENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "SKIPPED",
]);
export const contactConsentStatusEnum = pgEnum("contact_consent_status", [
  "OPTED_IN",
  "OPTED_OUT",
]);
export const whatsappInboundKindEnum = pgEnum("whatsapp_inbound_kind", [
  "MESSAGE",
  "STATUS",
]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);
export const quoteRouteEnum = pgEnum("quote_route", [
  "PREFERRED",
  "ALTERNATIVE",
]);
export const quoteAttemptStatusEnum = pgEnum("quote_attempt_status", [
  "STARTED",
  "SUCCEEDED",
  "FAILED",
]);
export const bookingIntentStatusEnum = pgEnum("booking_intent_status", [
  "PREPARED",
  "SUBMITTED",
  "UNKNOWN",
  "CONFIRMED",
  "FAILED",
  "CANCELLED",
]);
export const bookingStateEnum = pgEnum("booking_state", [
  "PENDING",
  "BOOKED",
  "UNKNOWN",
  "FAILED",
  "CANCELLED",
]);
export const verificationResultEnum = pgEnum("verification_result", [
  "PASS",
  "FAIL",
]);
export const jobStateEnum = pgEnum("job_state", [
  "READY",
  "RUNNING",
  "COMPLETED",
  "DEAD",
  "CANCELLED",
]);

export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    maxShippingNgn: integer("max_shipping_ngn").notNull(),
    mode: shippingModeEnum("mode").notNull().default("DEMO_SANDBOX"),
    ...timestamps(),
  },
  (table) => [
    check("merchants_currency_ngn_check", sql`${table.currency} = 'NGN'`),
    check(
      "merchants_max_shipping_nonnegative_check",
      sql`${table.maxShippingNgn} >= 0`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    orderNumber: varchar("order_number", { length: 80 }).notNull().unique(),
    amountNgn: integer("amount_ngn").notNull(),
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("UNKNOWN"),
    addressJson: jsonb("address_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    fulfillmentStatus: fulfillmentStatusEnum("fulfillment_status")
      .notNull()
      .default("BLOCKED"),
    ...timestamps(),
  },
  (table) => [
    index("orders_merchant_id_idx").on(table.merchantId),
    check("orders_amount_nonnegative_check", sql`${table.amountNgn} >= 0`),
  ],
);

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    status: caseStatusEnum("status").notNull().default("NEW"),
    blocker: varchar("blocker", { length: 120 }),
    // Deliberately not an FK: runs also reference cases, and the active run is
    // maintained by the case-transition transaction as a pointer.
    activeRunId: uuid("active_run_id"),
    version: integer("version").notNull().default(0),
    lastEventSeq: integer("last_event_seq").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index("cases_order_id_idx").on(table.orderId),
    index("cases_status_created_at_idx").on(table.status, table.createdAt),
    check("cases_version_nonnegative_check", sql`${table.version} >= 0`),
    check(
      "cases_last_event_seq_nonnegative_check",
      sql`${table.lastEventSeq} >= 0`,
    ),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    engineVersion: varchar("engine_version", { length: 80 }).notNull(),
    status: runStatusEnum("status").notNull().default("QUEUED"),
    traceRef: varchar("trace_ref", { length: 512 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("runs_case_attempt_uidx").on(table.caseId, table.attempt),
    index("runs_case_status_idx").on(table.caseId, table.status),
    check("runs_attempt_positive_check", sql`${table.attempt} > 0`),
  ],
);

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => agentTasks.id, {
      onDelete: "set null",
    }),
    role: taskRoleEnum("role").notNull(),
    goal: varchar("goal", { length: 500 }).notNull(),
    status: taskStatusEnum("status").notNull().default("QUEUED"),
    inputJson: jsonb("input_json").$type<Record<string, unknown>>(),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    index("agent_tasks_run_status_idx").on(table.runId, table.status),
    index("agent_tasks_parent_task_id_idx").on(table.parentTaskId),
  ],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: caseEventTypeEnum("type").notNull(),
    actor: eventActorEnum("actor").notNull(),
    taskId: uuid("task_id").references(() => agentTasks.id, {
      onDelete: "set null",
    }),
    publicPayload: jsonb("public_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("case_events_case_seq_uidx").on(table.caseId, table.seq),
    index("case_events_case_occurred_at_idx").on(
      table.caseId,
      table.occurredAt,
    ),
    check("case_events_seq_positive_check", sql`${table.seq} > 0`),
  ],
);

export const toolAttempts = pgTable(
  "tool_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => agentTasks.id, { onDelete: "cascade" }),
    tool: varchar("tool", { length: 120 }).notNull(),
    attempt: integer("attempt").notNull(),
    resultCode: varchar("result_code", { length: 120 }),
    status: attemptStatusEnum("status").notNull().default("STARTED"),
    latencyMs: integer("latency_ms"),
    safeResultJson: jsonb("safe_result_json").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("tool_attempts_task_tool_attempt_uidx").on(
      table.taskId,
      table.tool,
      table.attempt,
    ),
    check("tool_attempts_attempt_positive_check", sql`${table.attempt} > 0`),
    check(
      "tool_attempts_latency_nonnegative_check",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),
  ],
);

export const correctionRequests = pgTable(
  "correction_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    status: correctionStatusEnum("status").notNull().default("PENDING"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    index("correction_requests_case_status_idx").on(table.caseId, table.status),
    uniqueIndex("correction_requests_one_pending_per_case_uidx")
      .on(table.caseId)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    correctionRequestId: uuid("correction_request_id")
      .notNull()
      .references(() => correctionRequests.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull().unique(),
    templateName: varchar("template_name", { length: 120 }).notNull(),
    templateLanguage: varchar("template_language", { length: 16 }).notNull(),
    status: whatsappMessageStatusEnum("status").notNull().default("PENDING"),
    providerMessageId: varchar("provider_message_id", { length: 160 }),
    recipientHash: varchar("recipient_hash", { length: 128 }).notNull(),
    errorCode: varchar("error_code", { length: 160 }),
    attemptCount: integer("attempt_count").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index("whatsapp_messages_case_status_idx").on(table.caseId, table.status),
    index("whatsapp_messages_correction_idx").on(table.correctionRequestId),
    check("whatsapp_messages_attempt_nonnegative_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" })
      .unique(),
    lookupHash: varchar("lookup_hash", { length: 128 }).notNull(),
    phoneIv: varchar("phone_iv", { length: 64 }).notNull(),
    phoneCiphertext: text("phone_ciphertext").notNull(),
    consentStatus: contactConsentStatusEnum("consent_status").notNull().default("OPTED_OUT"),
    consentProvenance: varchar("consent_provenance", { length: 120 }).notNull(),
    provisionedBy: varchar("provisioned_by", { length: 120 }).notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    index("customer_contacts_lookup_hash_idx").on(table.lookupHash),
  ],
);

export const whatsappInboundEvents = pgTable(
  "whatsapp_inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerMessageId: varchar("provider_message_id", { length: 160 }).notNull().unique(),
    kind: whatsappInboundKindEnum("kind").notNull(),
    statusValue: varchar("status_value", { length: 40 }),
    senderLookupHash: varchar("sender_lookup_hash", { length: 128 }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    correctionRequestId: uuid("correction_request_id")
      .references(() => correctionRequests.id, { onDelete: "cascade" }),
    resultCode: varchar("result_code", { length: 120 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("whatsapp_inbound_events_case_idx").on(table.caseId),
  ],
);

export const quoteAttempts = pgTable(
  "quote_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => agentTasks.id, {
      onDelete: "set null",
    }),
    route: quoteRouteEnum("route").notNull(),
    provider: varchar("provider", { length: 120 }).notNull(),
    attempt: integer("attempt").notNull(),
    status: quoteAttemptStatusEnum("status").notNull().default("STARTED"),
    resultCode: varchar("result_code", { length: 120 }),
    latencyMs: integer("latency_ms"),
    safeResultJson: jsonb("safe_result_json").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("quote_attempts_case_route_attempt_uidx").on(
      table.caseId,
      table.route,
      table.attempt,
    ),
    index("quote_attempts_run_id_idx").on(table.runId),
    check("quote_attempts_attempt_positive_check", sql`${table.attempt} > 0`),
    check(
      "quote_attempts_latency_nonnegative_check",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),
  ],
);

export const quoteOptions = pgTable(
  "quote_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    quoteAttemptId: uuid("quote_attempt_id").references(() => quoteAttempts.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 120 }).notNull(),
    service: varchar("service", { length: 160 }).notNull(),
    amountNgn: integer("amount_ngn").notNull(),
    eligible: boolean("eligible").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    // Provider quote credentials remain server-side and are never included in
    // public event payloads or API projections.
    quoteToken: text("quote_token"),
    ...timestamps(),
  },
  (table) => [
    index("quote_options_case_eligible_idx").on(table.caseId, table.eligible),
    index("quote_options_run_id_idx").on(table.runId),
    check("quote_options_amount_nonnegative_check", sql`${table.amountNgn} >= 0`),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    quoteOptionId: uuid("quote_option_id").references(() => quoteOptions.id, {
      onDelete: "set null",
    }),
    proposalHash: varchar("proposal_hash", { length: 128 }).notNull(),
    requestedCostNgn: integer("requested_cost_ngn").notNull(),
    status: approvalStatusEnum("status").notNull().default("PENDING"),
    reviewedBy: varchar("reviewed_by", { length: 160 }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    index("approvals_case_status_idx").on(table.caseId, table.status),
    uniqueIndex("approvals_one_pending_per_case_uidx")
      .on(table.caseId)
      .where(sql`${table.status} = 'PENDING'`),
    check(
      "approvals_requested_cost_nonnegative_check",
      sql`${table.requestedCostNgn} >= 0`,
    ),
  ],
);

export const bookingIntents = pgTable(
  "booking_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    quoteOptionId: uuid("quote_option_id")
      .notNull()
      .references(() => quoteOptions.id, { onDelete: "restrict" }),
    approvalId: uuid("approval_id").references(() => approvals.id, {
      onDelete: "set null",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 200 })
      .notNull()
      .unique(),
    mode: shippingModeEnum("mode").notNull(),
    status: bookingIntentStatusEnum("status").notNull().default("PREPARED"),
    requestJson: jsonb("request_json").$type<Record<string, unknown>>().notNull(),
    providerBookingId: varchar("provider_booking_id", { length: 200 }),
    outcomeCode: varchar("outcome_code", { length: 120 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    index("booking_intents_case_status_idx").on(table.caseId, table.status),
    uniqueIndex("booking_intents_one_active_per_case_uidx")
      .on(table.caseId)
      .where(
        sql`${table.status} IN ('PREPARED', 'SUBMITTED', 'UNKNOWN')`,
      ),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    bookingIntentId: uuid("booking_intent_id")
      .notNull()
      .references(() => bookingIntents.id, { onDelete: "restrict" })
      .unique(),
    idempotencyKey: varchar("idempotency_key", { length: 200 })
      .notNull()
      .unique(),
    provider: varchar("provider", { length: 120 }).notNull(),
    providerBookingId: varchar("provider_booking_id", { length: 200 }),
    providerReference: varchar("provider_reference", { length: 200 }),
    state: bookingStateEnum("state").notNull().default("PENDING"),
    mode: shippingModeEnum("mode").notNull(),
    costNgn: integer("cost_ngn").notNull(),
    bookedAt: timestamp("booked_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    index("bookings_case_state_idx").on(table.caseId, table.state),
    uniqueIndex("bookings_one_active_per_case_uidx")
      .on(table.caseId)
      .where(sql`${table.state} IN ('PENDING', 'BOOKED', 'UNKNOWN')`),
    check("bookings_cost_nonnegative_check", sql`${table.costNgn} >= 0`),
  ],
);

export const evidenceReceipts = pgTable(
  "evidence_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    verificationJson: jsonb("verification_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    result: verificationResultEnum("result").notNull(),
  },
  (table) => [
    index("evidence_receipts_case_verified_at_idx").on(
      table.caseId,
      table.verifiedAt,
    ),
    uniqueIndex("evidence_receipts_one_pass_per_booking_uidx")
      .on(table.bookingId)
      .where(sql`${table.result} = 'PASS'`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    step: varchar("step", { length: 120 }).notNull(),
    state: jobStateEnum("state").notNull().default("READY"),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull().unique(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    attempt: integer("attempt").notNull().default(0),
    leaseOwner: varchar("lease_owner", { length: 160 }),
    leaseToken: varchar("lease_token", { length: 64 }),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    index("jobs_ready_available_idx").on(table.state, table.availableAt),
    index("jobs_case_state_idx").on(table.caseId, table.state),
    uniqueIndex("jobs_one_active_per_case_uidx")
      .on(table.caseId)
      .where(sql`${table.state} IN ('READY', 'RUNNING')`),
    check("jobs_attempt_nonnegative_check", sql`${table.attempt} >= 0`),
    check(
      "jobs_running_lease_check",
      sql`(${table.state} <> 'RUNNING') OR (${table.leaseOwner} IS NOT NULL AND ${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL)`,
    ),
  ],
);

export const demoFaults = pgTable(
  "demo_faults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    tool: varchar("tool", { length: 120 }).notNull(),
    remainingFailures: integer("remaining_failures").notNull().default(0),
    errorCode: varchar("error_code", { length: 120 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("demo_faults_case_tool_uidx").on(table.caseId, table.tool),
    check(
      "demo_faults_remaining_nonnegative_check",
      sql`${table.remainingFailures} >= 0`,
    ),
  ],
);

export const schema = {
  approvals,
  agentTasks,
  bookingIntents,
  bookings,
  cases,
  caseEvents,
  correctionRequests,
  customerContacts,
  demoFaults,
  evidenceReceipts,
  jobs,
  merchants,
  orders,
  quoteAttempts,
  quoteOptions,
  runs,
  toolAttempts,
  whatsappMessages,
  whatsappInboundEvents,
};

export type Merchant = typeof merchants.$inferSelect;
export type NewMerchant = typeof merchants.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type CaseRecord = typeof cases.$inferSelect;
export type NewCaseRecord = typeof cases.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = typeof agentTasks.$inferInsert;
export type CaseEvent = typeof caseEvents.$inferSelect;
export type NewCaseEvent = typeof caseEvents.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;
export type CustomerContact = typeof customerContacts.$inferSelect;
export type WhatsappInboundEvent = typeof whatsappInboundEvents.$inferSelect;
export type ClaimedJob = Job & {
  state: "RUNNING";
  leaseOwner: string;
  leaseToken: string;
  leaseUntil: Date;
};
