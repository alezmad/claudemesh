-- API keys for REST + external WS access (v0.2.0).
--
-- Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
--
-- Bearer-token auth for non-WS clients (humans on the dashboard, scripts,
-- bots, mobile apps). The secret is shown once at creation, then only
-- the Argon2id hash is stored. Capabilities + topic_scopes constrain
-- what each key can do — a CI bot key gets `send/read` on `#deploys`
-- only, never the whole mesh.
--
-- Additive — no breaking changes. CLI/web can ignore the table until
-- the issuance verbs ship in 0.2.0.

CREATE TYPE "mesh"."api_key_capability" AS ENUM (
  'send', 'read', 'state_write', 'admin'
);

CREATE TABLE IF NOT EXISTS "mesh"."api_key" (
  "id" text PRIMARY KEY NOT NULL,
  "mesh_id" text NOT NULL REFERENCES "mesh"."mesh"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "label" text NOT NULL,
  "secret_hash" text NOT NULL,
  "secret_prefix" text NOT NULL,
  "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "topic_scopes" jsonb,
  "issued_by_member_id" text REFERENCES "mesh"."member"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  "expires_at" timestamp
);

CREATE INDEX IF NOT EXISTS "api_key_by_mesh" ON "mesh"."api_key" ("mesh_id");
CREATE INDEX IF NOT EXISTS "api_key_by_prefix" ON "mesh"."api_key" ("secret_prefix");
