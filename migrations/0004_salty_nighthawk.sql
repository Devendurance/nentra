ALTER TYPE "public"."whatsapp_message_status" ADD VALUE 'DELIVERED' BEFORE 'FAILED';--> statement-breakpoint
ALTER TYPE "public"."whatsapp_message_status" ADD VALUE 'READ' BEFORE 'FAILED';