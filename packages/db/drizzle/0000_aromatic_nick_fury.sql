CREATE TYPE "public"."agent_group_mode" AS ENUM('coordinator');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel_kind" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel_status" AS ENUM('pending', 'verified', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_target_format" AS ENUM('full', 'summary');--> statement-breakpoint
CREATE TYPE "public"."delivery_target_owner_type" AS ENUM('agent', 'group', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('google');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'tool_result');--> statement-breakpoint
CREATE TYPE "public"."provider_credential_status" AS ENUM('unchecked', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('chat', 'api', 'schedule', 'manual', 'delegation');--> statement-breakpoint
CREATE TYPE "public"."schedule_target_type" AS ENUM('agent', 'group');--> statement-breakpoint
CREATE TYPE "public"."spend_limit_action" AS ENUM('warn', 'block');--> statement-breakpoint
CREATE TYPE "public"."spend_limit_scope" AS ENUM('workspace', 'agent', 'credential');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('pending', 'waiting_approval', 'running', 'succeeded', 'failed', 'denied');--> statement-breakpoint
CREATE TYPE "public"."tool_connection_kind" AS ENUM('web_search', 'http', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."tool_connection_mode" AS ENUM('read_only', 'read_write');--> statement-breakpoint
CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"current_version_id" uuid,
	"template_id" uuid,
	"created_by" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"instructions" text NOT NULL,
	"suggested_params" jsonb NOT NULL,
	"suggested_tools" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"instructions" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"credential_id" uuid,
	"params" jsonb NOT NULL,
	"tools" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_version_agent_id_version_unique" UNIQUE("agent_id","version"),
	CONSTRAINT "agent_version_version_positive" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"name" varchar(255) NOT NULL,
	"prefix" varchar(8) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_token_id" uuid,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(100) NOT NULL,
	"target_id" uuid NOT NULL,
	"metadata" jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"title" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_credential" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"alias" varchar(255) NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"kek_version" varchar(64) NOT NULL,
	"last4" varchar(4),
	"base_url" text,
	"status" "provider_credential_status" DEFAULT 'unchecked' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	CONSTRAINT "provider_credential_workspace_id_alias_unique" UNIQUE("workspace_id","alias"),
	CONSTRAINT "provider_credential_base_url_only_openai_compatible" CHECK (base_url IS NULL OR provider_id = 'openai-compatible')
);
--> statement-breakpoint
CREATE TABLE "tool_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "tool_connection_kind" NOT NULL,
	"name" varchar(255) NOT NULL,
	"config" jsonb NOT NULL,
	"secret_ciphertext" text,
	"secret_iv" text,
	"secret_auth_tag" text,
	"secret_kek_version" varchar(64),
	"mode" "tool_connection_mode" DEFAULT 'read_only' NOT NULL,
	"status" text,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_run_id_channel_id_unique" UNIQUE("run_id","channel_id"),
	CONSTRAINT "delivery_attempts_non_negative" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_channel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "delivery_channel_kind" NOT NULL,
	"address" text NOT NULL,
	"label" varchar(255),
	"verified_at" timestamp with time zone,
	"verification_code_hash" varchar(64),
	"whatsapp_window_expires_at" timestamp with time zone,
	"status" "delivery_channel_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_target" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_type" "delivery_target_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"format" "delivery_target_format" DEFAULT 'full' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_group" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"goal" text,
	"coordinator_agent_id" uuid NOT NULL,
	"mode" "agent_group_mode" DEFAULT 'coordinator' NOT NULL,
	"max_delegations" integer DEFAULT 8 NOT NULL,
	"max_cost_usd" numeric(14, 6) DEFAULT '0.500000' NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	CONSTRAINT "agent_group_max_delegations_positive" CHECK (max_delegations > 0),
	CONSTRAINT "agent_group_max_cost_usd_positive" CHECK (max_cost_usd > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_group_member" (
	"group_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" varchar(64) NOT NULL,
	"role_description" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_group_member_group_id_agent_id_pk" PRIMARY KEY("group_id","agent_id"),
	CONSTRAINT "agent_group_member_group_id_slug_unique" UNIQUE("group_id","slug"),
	CONSTRAINT "agent_group_member_position_non_negative" CHECK (position >= 0)
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"account_email" varchar(255) NOT NULL,
	"scopes" text[] NOT NULL,
	"refresh_ciphertext" text NOT NULL,
	"refresh_iv" text NOT NULL,
	"refresh_auth_tag" text NOT NULL,
	"refresh_kek_version" varchar(64) NOT NULL,
	"access_expires_at" timestamp with time zone,
	"status" "integration_status" DEFAULT 'connected' NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"run_id" uuid,
	"role" "message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_call_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decision" "approval_decision",
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"group_id" uuid,
	"parent_run_id" uuid,
	"root_run_id" uuid NOT NULL,
	"conversation_id" uuid,
	"trigger" "run_trigger" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error_code" varchar(100),
	"error_message" text,
	"idempotency_key" text,
	"api_token_id" uuid,
	"schedule_id" uuid,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_workspace_id_idempotency_key_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "run_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_event_run_id_seq_unique" UNIQUE("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_type" "schedule_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"cron" varchar(100) NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"input" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_id" uuid,
	"next_run_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "tool_call" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_tool_call_id" text NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"args" jsonb NOT NULL,
	"status" "tool_call_status" DEFAULT 'pending' NOT NULL,
	"result_summary" text,
	"is_error" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "tool_call_run_id_provider_tool_call_id_unique" UNIQUE("run_id","provider_tool_call_id"),
	CONSTRAINT "tool_call_duration_non_negative" CHECK (duration_ms >= 0)
);
--> statement-breakpoint
CREATE TABLE "spend_limit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" "spend_limit_scope" NOT NULL,
	"scope_id" uuid,
	"monthly_usd" numeric(14, 6) NOT NULL,
	"action" "spend_limit_action" NOT NULL,
	CONSTRAINT "spend_limit_monthly_usd_positive" CHECK (monthly_usd > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"cost_usd" numeric(14, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_record_tokens_non_negative" CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0 AND cache_write_tokens >= 0),
	CONSTRAINT "usage_record_cost_non_negative" CHECK (cost_usd >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_key" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"kek_version" varchar(64) NOT NULL,
	"wrapped_dek" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_template_id_agent_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_credential_id_provider_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credential"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_token_id_api_token_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."api_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_channel_id_delivery_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."delivery_channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_target" ADD CONSTRAINT "delivery_target_channel_id_delivery_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."delivery_channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_group" ADD CONSTRAINT "agent_group_coordinator_agent_id_agent_id_fk" FOREIGN KEY ("coordinator_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_group_member" ADD CONSTRAINT "agent_group_member_group_id_agent_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."agent_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_group_member" ADD CONSTRAINT "agent_group_member_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_tool_call_id_tool_call_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_group_id_agent_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."agent_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_parent_run_id_run_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_root_run_id_run_id_fk" FOREIGN KEY ("root_run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_api_token_id_api_token_id_fk" FOREIGN KEY ("api_token_id") REFERENCES "public"."api_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_event" ADD CONSTRAINT "run_event_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_last_run_id_run_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_workspace_id_idx" ON "agent" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_version_workspace_id_idx" ON "agent_version" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_token_workspace_id_idx" ON "api_token" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_id_idx" ON "audit_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "conversation_workspace_id_idx" ON "conversation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "provider_credential_workspace_id_idx" ON "provider_credential" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tool_connection_workspace_id_idx" ON "tool_connection" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "delivery_workspace_id_idx" ON "delivery" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "delivery_run_id_idx" ON "delivery" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "delivery_channel_workspace_id_idx" ON "delivery_channel" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "delivery_target_workspace_id_idx" ON "delivery_target" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_group_workspace_id_idx" ON "agent_group" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_group_member_workspace_id_idx" ON "agent_group_member" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "integration_workspace_id_idx" ON "integration" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "message_workspace_id_idx" ON "message" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "message_conversation_id_created_at_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_workspace_id_idx" ON "approval" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "run_workspace_id_idx" ON "run" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "run_workspace_id_status_idx" ON "run" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "run_conversation_id_queued_at_idx" ON "run" USING btree ("conversation_id","queued_at");--> statement-breakpoint
CREATE INDEX "run_root_run_id_idx" ON "run" USING btree ("root_run_id");--> statement-breakpoint
CREATE INDEX "run_group_id_queued_at_idx" ON "run" USING btree ("group_id","queued_at");--> statement-breakpoint
CREATE INDEX "run_event_workspace_id_idx" ON "run_event" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "schedule_workspace_id_idx" ON "schedule" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tool_call_workspace_id_idx" ON "tool_call" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tool_call_run_id_idx" ON "tool_call" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "spend_limit_workspace_id_idx" ON "spend_limit" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_record_workspace_id_idx" ON "usage_record" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_record_workspace_id_created_at_idx" ON "usage_record" USING btree ("workspace_id","created_at");