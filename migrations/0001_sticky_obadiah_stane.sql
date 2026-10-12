ALTER TABLE "jobs" DROP CONSTRAINT "jobs_running_lease_check";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_token" varchar(64);--> statement-breakpoint
UPDATE "jobs" SET "lease_token" = gen_random_uuid()::text WHERE "state" = 'RUNNING' AND "lease_token" IS NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_running_lease_check" CHECK (("jobs"."state" <> 'RUNNING') OR ("jobs"."lease_owner" IS NOT NULL AND "jobs"."lease_token" IS NOT NULL AND "jobs"."lease_until" IS NOT NULL));
