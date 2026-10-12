CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."booking_intent_status" AS ENUM('PREPARED', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."booking_state" AS ENUM('PENDING', 'BOOKED', 'UNKNOWN', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."case_event_type" AS ENUM('CASE_STARTED', 'PLAN_CREATED', 'TASK_DELEGATED', 'AGENT_STARTED', 'AGENT_COMPLETED', 'TOOL_CALLED', 'TOOL_FAILED', 'RETRY_SCHEDULED', 'FALLBACK_SELECTED', 'CUSTOMER_INPUT_REQUIRED', 'CUSTOMER_INPUT_RECEIVED', 'APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'BOOKING_CREATED', 'VERIFICATION_STARTED', 'VERIFICATION_PASSED', 'VERIFICATION_FAILED', 'CASE_ESCALATED', 'CASE_RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('NEW', 'TRIAGING', 'WAITING_CUSTOMER', 'QUOTING', 'RECOVERING', 'WAITING_APPROVAL', 'BOOKING', 'VERIFYING', 'RESOLVED', 'ESCALATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('PENDING', 'COMPLETED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."event_actor" AS ENUM('controller', 'investigator', 'liaison', 'fulfillment', 'recovery', 'verifier', 'system', 'customer', 'merchant');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('BLOCKED', 'READY', 'BOOKED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('READY', 'RUNNING', 'COMPLETED', 'DEAD', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PAID', 'UNPAID', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."quote_attempt_status" AS ENUM('STARTED', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."quote_route" AS ENUM('PREFERRED', 'ALTERNATIVE');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('QUEUED', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."shipping_mode" AS ENUM('DEMO_SANDBOX', 'SHIPBUBBLE_TEST', 'LIVE');--> statement-breakpoint
CREATE TYPE "public"."task_role" AS ENUM('controller', 'investigator', 'liaison', 'fulfillment', 'recovery', 'verifier');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('QUEUED', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."verification_result" AS ENUM('PASS', 'FAIL');--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"role" "task_role" NOT NULL,
	"goal" varchar(500) NOT NULL,
	"status" "task_status" DEFAULT 'QUEUED' NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"quote_option_id" uuid,
	"proposal_hash" varchar(128) NOT NULL,
	"requested_cost_ngn" integer NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" varchar(160),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_requested_cost_nonnegative_check" CHECK ("approvals"."requested_cost_ngn" >= 0)
);
--> statement-breakpoint
CREATE TABLE "booking_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"quote_option_id" uuid NOT NULL,
	"approval_id" uuid,
	"idempotency_key" varchar(200) NOT NULL,
	"mode" "shipping_mode" NOT NULL,
	"status" "booking_intent_status" DEFAULT 'PREPARED' NOT NULL,
	"request_json" jsonb NOT NULL,
	"provider_booking_id" varchar(200),
	"outcome_code" varchar(120),
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_intents_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"booking_intent_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"provider" varchar(120) NOT NULL,
	"provider_booking_id" varchar(200),
	"provider_reference" varchar(200),
	"state" "booking_state" DEFAULT 'PENDING' NOT NULL,
	"mode" "shipping_mode" NOT NULL,
	"cost_ngn" integer NOT NULL,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_booking_intent_id_unique" UNIQUE("booking_intent_id"),
	CONSTRAINT "bookings_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "bookings_cost_nonnegative_check" CHECK ("bookings"."cost_ngn" >= 0)
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" "case_event_type" NOT NULL,
	"actor" "event_actor" NOT NULL,
	"task_id" uuid,
	"public_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_events_seq_positive_check" CHECK ("case_events"."seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "case_status" DEFAULT 'NEW' NOT NULL,
	"blocker" varchar(120),
	"active_run_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"last_event_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_version_nonnegative_check" CHECK ("cases"."version" >= 0),
	CONSTRAINT "cases_last_event_seq_nonnegative_check" CHECK ("cases"."last_event_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "correction_status" DEFAULT 'PENDING' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correction_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "demo_faults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tool" varchar(120) NOT NULL,
	"remaining_failures" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_faults_remaining_nonnegative_check" CHECK ("demo_faults"."remaining_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "evidence_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"verification_json" jsonb NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" "verification_result" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step" varchar(120) NOT NULL,
	"state" "job_state" DEFAULT 'READY' NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"payload_json" jsonb,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(160),
	"lease_until" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"last_error_code" varchar(120),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "jobs_attempt_nonnegative_check" CHECK ("jobs"."attempt" >= 0),
	CONSTRAINT "jobs_running_lease_check" CHECK (("jobs"."state" <> 'RUNNING') OR ("jobs"."lease_owner" IS NOT NULL AND "jobs"."lease_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"max_shipping_ngn" integer NOT NULL,
	"mode" "shipping_mode" DEFAULT 'DEMO_SANDBOX' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_currency_ngn_check" CHECK ("merchants"."currency" = 'NGN'),
	CONSTRAINT "merchants_max_shipping_nonnegative_check" CHECK ("merchants"."max_shipping_ngn" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_number" varchar(80) NOT NULL,
	"amount_ngn" integer NOT NULL,
	"payment_status" "payment_status" DEFAULT 'UNKNOWN' NOT NULL,
	"address_json" jsonb NOT NULL,
	"fulfillment_status" "fulfillment_status" DEFAULT 'BLOCKED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_amount_nonnegative_check" CHECK ("orders"."amount_ngn" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid,
	"route" "quote_route" NOT NULL,
	"provider" varchar(120) NOT NULL,
	"attempt" integer NOT NULL,
	"status" "quote_attempt_status" DEFAULT 'STARTED' NOT NULL,
	"result_code" varchar(120),
	"latency_ms" integer,
	"safe_result_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_attempts_attempt_positive_check" CHECK ("quote_attempts"."attempt" > 0),
	CONSTRAINT "quote_attempts_latency_nonnegative_check" CHECK ("quote_attempts"."latency_ms" IS NULL OR "quote_attempts"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"quote_attempt_id" uuid,
	"provider" varchar(120) NOT NULL,
	"service" varchar(160) NOT NULL,
	"amount_ngn" integer NOT NULL,
	"eligible" boolean NOT NULL,
	"expires_at" timestamp with time zone,
	"quote_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_options_amount_nonnegative_check" CHECK ("quote_options"."amount_ngn" >= 0)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"engine_version" varchar(80) NOT NULL,
	"status" "run_status" DEFAULT 'QUEUED' NOT NULL,
	"trace_ref" varchar(512),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_attempt_positive_check" CHECK ("runs"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "tool_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"tool" varchar(120) NOT NULL,
	"attempt" integer NOT NULL,
	"result_code" varchar(120),
	"status" "attempt_status" DEFAULT 'STARTED' NOT NULL,
	"latency_ms" integer,
	"safe_result_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_attempts_attempt_positive_check" CHECK ("tool_attempts"."attempt" > 0),
	CONSTRAINT "tool_attempts_latency_nonnegative_check" CHECK ("tool_attempts"."latency_ms" IS NULL OR "tool_attempts"."latency_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_parent_task_id_agent_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_quote_option_id_quote_options_id_fk" FOREIGN KEY ("quote_option_id") REFERENCES "public"."quote_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_intents" ADD CONSTRAINT "booking_intents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_intents" ADD CONSTRAINT "booking_intents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_intents" ADD CONSTRAINT "booking_intents_quote_option_id_quote_options_id_fk" FOREIGN KEY ("quote_option_id") REFERENCES "public"."quote_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_intents" ADD CONSTRAINT "booking_intents_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booking_intent_id_booking_intents_id_fk" FOREIGN KEY ("booking_intent_id") REFERENCES "public"."booking_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_faults" ADD CONSTRAINT "demo_faults_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD CONSTRAINT "evidence_receipts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD CONSTRAINT "evidence_receipts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attempts" ADD CONSTRAINT "quote_attempts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attempts" ADD CONSTRAINT "quote_attempts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attempts" ADD CONSTRAINT "quote_attempts_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_quote_attempt_id_quote_attempts_id_fk" FOREIGN KEY ("quote_attempt_id") REFERENCES "public"."quote_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_attempts" ADD CONSTRAINT "tool_attempts_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tasks_run_status_idx" ON "agent_tasks" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "agent_tasks_parent_task_id_idx" ON "agent_tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "approvals_case_status_idx" ON "approvals" USING btree ("case_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_pending_per_case_uidx" ON "approvals" USING btree ("case_id") WHERE "approvals"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "booking_intents_case_status_idx" ON "booking_intents" USING btree ("case_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_intents_one_active_per_case_uidx" ON "booking_intents" USING btree ("case_id") WHERE "booking_intents"."status" IN ('PREPARED', 'SUBMITTED', 'UNKNOWN');--> statement-breakpoint
CREATE INDEX "bookings_case_state_idx" ON "bookings" USING btree ("case_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_per_case_uidx" ON "bookings" USING btree ("case_id") WHERE "bookings"."state" IN ('PENDING', 'BOOKED', 'UNKNOWN');--> statement-breakpoint
CREATE UNIQUE INDEX "case_events_case_seq_uidx" ON "case_events" USING btree ("case_id","seq");--> statement-breakpoint
CREATE INDEX "case_events_case_occurred_at_idx" ON "case_events" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cases_order_id_idx" ON "cases" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cases_status_created_at_idx" ON "cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "correction_requests_case_status_idx" ON "correction_requests" USING btree ("case_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "correction_requests_one_pending_per_case_uidx" ON "correction_requests" USING btree ("case_id") WHERE "correction_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "demo_faults_case_tool_uidx" ON "demo_faults" USING btree ("case_id","tool");--> statement-breakpoint
CREATE INDEX "evidence_receipts_case_verified_at_idx" ON "evidence_receipts" USING btree ("case_id","verified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_receipts_one_pass_per_booking_uidx" ON "evidence_receipts" USING btree ("booking_id") WHERE "evidence_receipts"."result" = 'PASS';--> statement-breakpoint
CREATE INDEX "jobs_ready_available_idx" ON "jobs" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "jobs_case_state_idx" ON "jobs" USING btree ("case_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_active_per_case_uidx" ON "jobs" USING btree ("case_id") WHERE "jobs"."state" IN ('READY', 'RUNNING');--> statement-breakpoint
CREATE INDEX "orders_merchant_id_idx" ON "orders" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_attempts_case_route_attempt_uidx" ON "quote_attempts" USING btree ("case_id","route","attempt");--> statement-breakpoint
CREATE INDEX "quote_attempts_run_id_idx" ON "quote_attempts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "quote_options_case_eligible_idx" ON "quote_options" USING btree ("case_id","eligible");--> statement-breakpoint
CREATE INDEX "quote_options_run_id_idx" ON "quote_options" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_case_attempt_uidx" ON "runs" USING btree ("case_id","attempt");--> statement-breakpoint
CREATE INDEX "runs_case_status_idx" ON "runs" USING btree ("case_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_attempts_task_tool_attempt_uidx" ON "tool_attempts" USING btree ("task_id","tool","attempt");