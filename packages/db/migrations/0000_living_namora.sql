CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE SCHEMA "chat";
--> statement-breakpoint
CREATE SCHEMA "pdf";
--> statement-breakpoint
CREATE SCHEMA "image";
--> statement-breakpoint
CREATE SCHEMA "mesh";
--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('signup', 'purchase', 'usage', 'admin_grant', 'admin_deduct', 'refund', 'promo', 'referral', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'premium', 'enterprise');--> statement-breakpoint
CREATE TYPE "chat"."role" AS ENUM('system', 'assistant', 'user');--> statement-breakpoint
CREATE TYPE "pdf"."role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "pdf"."processing_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "pdf"."unit_type" AS ENUM('prose', 'heading', 'list', 'table', 'code');--> statement-breakpoint
CREATE TYPE "image"."aspect_ratio" AS ENUM('square', 'standard', 'landscape', 'portrait');--> statement-breakpoint
CREATE TYPE "mesh"."role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "mesh"."tier" AS ENUM('free', 'pro', 'team', 'enterprise');--> statement-breakpoint
CREATE TYPE "mesh"."transport" AS ENUM('managed', 'tailscale', 'self_hosted');--> statement-breakpoint
CREATE TYPE "mesh"."visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "mesh"."message_priority" AS ENUM('now', 'next', 'low');--> statement-breakpoint
CREATE TYPE "mesh"."presence_status" AS ENUM('idle', 'working', 'dnd');--> statement-breakpoint
CREATE TYPE "mesh"."presence_status_source" AS ENUM('hook', 'manual', 'jsonl');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	"is_anonymous" boolean DEFAULT false,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"amount" integer NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"reason" text,
	"metadata" text,
	"balance_after" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" "status",
	"plan" "plan",
	"credits" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "customer_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "customer_customerId_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."chat" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat"."message" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" "chat"."role" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat"."part" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"type" text NOT NULL,
	"order" integer NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pdf"."chat" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pdf"."citation_unit" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"retrieval_chunk_id" text,
	"content" text NOT NULL,
	"page_number" integer NOT NULL,
	"paragraph_index" integer NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"bbox_x" real,
	"bbox_y" real,
	"bbox_width" real,
	"bbox_height" real,
	"section_title" text,
	"unit_type" "pdf"."unit_type" DEFAULT 'prose',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pdf"."document" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"processing_status" "pdf"."processing_status" DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pdf"."embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"page_number" integer,
	"char_start" integer,
	"char_end" integer,
	"section_title" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pdf"."message" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"content" text NOT NULL,
	"role" "pdf"."role" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pdf"."retrieval_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"section_hierarchy" text[],
	"chunk_type" text DEFAULT 'prose',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "image"."generation" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"aspect_ratio" "image"."aspect_ratio" DEFAULT 'square' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "image"."image" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mesh"."audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_peer_id" text,
	"target_peer_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mesh"."invite" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"token" text NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"role" "mesh"."role" DEFAULT 'member' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "mesh"."mesh" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"visibility" "mesh"."visibility" DEFAULT 'private' NOT NULL,
	"transport" "mesh"."transport" DEFAULT 'managed' NOT NULL,
	"max_peers" integer,
	"tier" "mesh"."tier" DEFAULT 'free' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "mesh_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "mesh"."member" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"user_id" text,
	"peer_pubkey" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "mesh"."role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mesh"."message_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"sender_member_id" text NOT NULL,
	"target_spec" text NOT NULL,
	"priority" "mesh"."message_priority" DEFAULT 'next' NOT NULL,
	"nonce" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mesh"."pending_status" (
	"id" text PRIMARY KEY NOT NULL,
	"pid" integer NOT NULL,
	"cwd" text NOT NULL,
	"status" text NOT NULL,
	"status_source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mesh"."presence" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"session_id" text NOT NULL,
	"pid" integer NOT NULL,
	"cwd" text NOT NULL,
	"status" "mesh"."presence_status" DEFAULT 'idle' NOT NULL,
	"status_source" "mesh"."presence_status_source" DEFAULT 'jsonl' NOT NULL,
	"status_updated_at" timestamp DEFAULT now() NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_ping_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "chat"."chat"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "chat"."part" ADD CONSTRAINT "part_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."message"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pdf"."chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pdf"."citation_unit" ADD CONSTRAINT "citation_unit_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "pdf"."document"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pdf"."citation_unit" ADD CONSTRAINT "citation_unit_retrieval_chunk_id_retrieval_chunk_id_fk" FOREIGN KEY ("retrieval_chunk_id") REFERENCES "pdf"."retrieval_chunk"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pdf"."document" ADD CONSTRAINT "document_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "pdf"."chat"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pdf"."embedding" ADD CONSTRAINT "embedding_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "pdf"."document"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pdf"."message" ADD CONSTRAINT "message_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "pdf"."chat"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pdf"."retrieval_chunk" ADD CONSTRAINT "retrieval_chunk_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "pdf"."document"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "image"."generation" ADD CONSTRAINT "generation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "image"."image" ADD CONSTRAINT "image_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "image"."generation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."audit_log" ADD CONSTRAINT "audit_log_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."invite" ADD CONSTRAINT "invite_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."invite" ADD CONSTRAINT "invite_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."mesh" ADD CONSTRAINT "mesh_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."member" ADD CONSTRAINT "member_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."message_queue" ADD CONSTRAINT "message_queue_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."message_queue" ADD CONSTRAINT "message_queue_sender_member_id_member_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "mesh"."member"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."presence" ADD CONSTRAINT "presence_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "mesh"."member"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_cu_document" ON "pdf"."citation_unit" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_cu_retrieval" ON "pdf"."citation_unit" USING btree ("retrieval_chunk_id");--> statement-breakpoint
CREATE INDEX "idx_cu_page" ON "pdf"."citation_unit" USING btree ("document_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cu_unique" ON "pdf"."citation_unit" USING btree ("document_id","page_number","paragraph_index");--> statement-breakpoint
CREATE INDEX "pdf_embeddingIndex" ON "pdf"."embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_rc_document" ON "pdf"."retrieval_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_rc_embedding" ON "pdf"."retrieval_chunk" USING hnsw ("embedding" vector_cosine_ops);