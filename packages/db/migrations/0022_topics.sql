-- Topics — conversational primitive within a mesh (v0.2.0).
--
-- Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
--
-- Mesh = trust boundary. Group = identity tag. Topic = conversation scope.
-- Three orthogonal axes; topics complement (don't replace) groups.
--
-- Three new tables in the `mesh` pg-schema:
--   * mesh.topic            — named topic per mesh (unique on mesh_id, name)
--   * mesh.topic_member     — per-member subscriptions, with last_read_at
--   * mesh.topic_message    — persistent encrypted history (used for human-
--                             touched topics; agent-only topics may opt out)
--
-- Two new pg enums:
--   * mesh.topic_visibility   = public | private | dm
--   * mesh.topic_member_role  = lead | member | observer
--
-- Additive — no breaking changes to existing tables. Safe to deploy before
-- CLI/broker code knows about topics; the routing layer falls back to the
-- existing peer/group/* targeting until topic-tagged messages arrive.

CREATE TYPE "mesh"."topic_visibility" AS ENUM ('public', 'private', 'dm');
CREATE TYPE "mesh"."topic_member_role" AS ENUM ('lead', 'member', 'observer');

CREATE TABLE IF NOT EXISTS "mesh"."topic" (
  "id" text PRIMARY KEY NOT NULL,
  "mesh_id" text NOT NULL REFERENCES "mesh"."mesh"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "visibility" "mesh"."topic_visibility" NOT NULL DEFAULT 'public',
  "created_by_member_id" text REFERENCES "mesh"."member"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "archived_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "topic_mesh_name_unique"
  ON "mesh"."topic" ("mesh_id", "name");

CREATE TABLE IF NOT EXISTS "mesh"."topic_member" (
  "topic_id" text NOT NULL REFERENCES "mesh"."topic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "member_id" text NOT NULL REFERENCES "mesh"."member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" "mesh"."topic_member_role" NOT NULL DEFAULT 'member',
  "joined_at" timestamp DEFAULT now() NOT NULL,
  "last_read_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "topic_member_unique"
  ON "mesh"."topic_member" ("topic_id", "member_id");

CREATE INDEX IF NOT EXISTS "topic_member_by_member"
  ON "mesh"."topic_member" ("member_id");

CREATE TABLE IF NOT EXISTS "mesh"."topic_message" (
  "id" text PRIMARY KEY NOT NULL,
  "topic_id" text NOT NULL REFERENCES "mesh"."topic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sender_member_id" text NOT NULL REFERENCES "mesh"."member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sender_session_pubkey" text,
  "nonce" text NOT NULL,
  "ciphertext" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Composite index for the common access pattern: load topic history
-- ordered by time. Drives the web chat panel's infinite-scroll fetch.
CREATE INDEX IF NOT EXISTS "topic_message_by_topic_time"
  ON "mesh"."topic_message" ("topic_id", "created_at");
