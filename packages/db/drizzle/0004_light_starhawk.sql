ALTER TABLE "agent_version" DROP CONSTRAINT "agent_version_credential_id_provider_credential_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_credential_id_provider_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credential"("id") ON DELETE set null ON UPDATE no action;