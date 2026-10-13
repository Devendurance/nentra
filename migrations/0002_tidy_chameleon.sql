CREATE TYPE "public"."whatsapp_message_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"correction_request_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"template_name" varchar(120) NOT NULL,
	"template_language" varchar(16) NOT NULL,
	"status" "whatsapp_message_status" DEFAULT 'PENDING' NOT NULL,
	"provider_message_id" varchar(160),
	"recipient_hash" varchar(128) NOT NULL,
	"error_code" varchar(160),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "whatsapp_messages_attempt_nonnegative_check" CHECK ("whatsapp_messages"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_correction_request_id_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "public"."correction_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_case_status_idx" ON "whatsapp_messages" USING btree ("case_id","status");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_correction_idx" ON "whatsapp_messages" USING btree ("correction_request_id");