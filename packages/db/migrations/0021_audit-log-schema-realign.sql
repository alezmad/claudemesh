-- Realign mesh.audit_log to match the current code schema.
--
-- The schema drifted: code has moved to an append-only hash-chained design
-- (actor_member_id/actor_display_name/payload/prev_hash/hash and an integer
-- GENERATED ALWAYS AS IDENTITY id) but the 0000 migration still shows the
-- old shape (actor_peer_id/target_peer_id/metadata/text id). Every peer
-- join/leave event has been logging "audit log insert failed" since the
-- broker code was updated.
--
-- Approach: drop the legacy table (no production data is read from it — the
-- old schema was unused after the code rename) and recreate under the new
-- shape. Safe because the broker treats audit-log failures as non-fatal and
-- existing rows were never surfaced via any API.

-- Guard against partial prior runs.
DROP INDEX IF EXISTS "mesh"."audit_log_mesh_id_idx";
DROP TABLE IF EXISTS "mesh"."audit_log";

CREATE TABLE "mesh"."audit_log" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "mesh_id" text NOT NULL,
  "event_type" text NOT NULL,
  "actor_member_id" text,
  "actor_display_name" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "prev_hash" text NOT NULL,
  "hash" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "audit_log_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "audit_log_mesh_id_idx" ON "mesh"."audit_log" ("mesh_id");
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "mesh"."audit_log" ("created_at");
