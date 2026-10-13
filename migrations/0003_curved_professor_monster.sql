CREATE TYPE "public"."contact_consent_status" AS ENUM('OPTED_IN', 'OPTED_OUT');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_inbound_kind" AS ENUM('MESSAGE', 'STATUS');--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"lookup_hash" varchar(128) NOT NULL,
	"phone_iv" varchar(64) NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"consent_status" "contact_consent_status" DEFAULT 'OPTED_OUT' NOT NULL,
	"consent_provenance" varchar(120) NOT NULL,
	"provisioned_by" varchar(120) NOT NULL,
	"consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_contacts_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_message_id" varchar(160) NOT NULL,
	"kind" "whatsapp_inbound_kind" NOT NULL,
	"status_value" varchar(40),
	"sender_lookup_hash" varchar(128),
	"case_id" uuid,
	"correction_request_id" uuid,
	"result_code" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_inbound_events_provider_message_id_unique" UNIQUE("provider_message_id")
);
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbound_events" ADD CONSTRAINT "whatsapp_inbound_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbound_events" ADD CONSTRAINT "whatsapp_inbound_events_correction_request_id_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "public"."correction_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_contacts_lookup_hash_idx" ON "customer_contacts" USING btree ("lookup_hash");--> statement-breakpoint
CREATE INDEX "whatsapp_inbound_events_case_idx" ON "whatsapp_inbound_events" USING btree ("case_id");