ALTER TABLE "whatsapp_inbound_events" ADD COLUMN "provider" varchar(16) DEFAULT 'meta' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "provider" varchar(16) DEFAULT 'meta' NOT NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_provider_sid_idx" ON "whatsapp_messages" USING btree ("provider","provider_message_id");