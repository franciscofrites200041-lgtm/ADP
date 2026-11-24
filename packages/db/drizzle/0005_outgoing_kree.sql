ALTER TABLE "run" ADD COLUMN "turns_completed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "run_lease_until_idx" ON "run" USING btree ("lease_until");