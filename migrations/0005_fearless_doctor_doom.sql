ALTER TYPE "public"."whatsapp_message_status" ADD VALUE 'SENDING' BEFORE 'SENT';--> statement-breakpoint
ALTER TYPE "public"."whatsapp_message_status" ADD VALUE 'RETRYABLE' BEFORE 'SKIPPED';--> statement-breakpoint
ALTER TYPE "public"."whatsapp_message_status" ADD VALUE 'NEEDS_REVIEW' BEFORE 'SKIPPED';