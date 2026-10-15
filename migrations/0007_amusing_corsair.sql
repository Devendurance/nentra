CREATE TABLE "telegram_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"chat_lookup_hash" varchar(128),
	"chat_iv" varchar(64),
	"chat_ciphertext" text,
	"binding_token_hash" varchar(128),
	"binding_expires_at" timestamp with time zone,
	"consent_status" "contact_consent_status" DEFAULT 'OPTED_OUT' NOT NULL,
	"consent_provenance" varchar(120) NOT NULL,
	"provisioned_by" varchar(120) NOT NULL,
	"consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_contacts_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "telegram_contacts_binding_token_hash_unique" UNIQUE("binding_token_hash")
);
--> statement-breakpoint
CREATE TABLE "telegram_inbound_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"update_id" varchar(32) NOT NULL,
	"chat_lookup_hash" varchar(128),
	"case_id" uuid,
	"correction_request_id" uuid,
	"result_code" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_inbound_updates_update_id_unique" UNIQUE("update_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"correction_request_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"provider_message_id" varchar(160),
	"recipient_hash" varchar(128) NOT NULL,
	"error_code" varchar(160),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_outbound_messages_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "telegram_outbound_messages_attempt_nonnegative_check" CHECK ("telegram_outbound_messages"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "telegram_contacts" ADD CONSTRAINT "telegram_contacts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_inbound_updates" ADD CONSTRAINT "telegram_inbound_updates_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_inbound_updates" ADD CONSTRAINT "telegram_inbound_updates_correction_request_id_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "public"."correction_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbound_messages" ADD CONSTRAINT "telegram_outbound_messages_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbound_messages" ADD CONSTRAINT "telegram_outbound_messages_correction_request_id_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "public"."correction_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_contacts_chat_lookup_hash_idx" ON "telegram_contacts" USING btree ("chat_lookup_hash");--> statement-breakpoint
CREATE INDEX "telegram_inbound_updates_case_idx" ON "telegram_inbound_updates" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "telegram_outbound_messages_case_status_idx" ON "telegram_outbound_messages" USING btree ("case_id","status");--> statement-breakpoint
CREATE INDEX "telegram_outbound_messages_correction_idx" ON "telegram_outbound_messages" USING btree ("correction_request_id");