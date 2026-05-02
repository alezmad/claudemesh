-- 0024_general_topic_backfill.sql
--
-- Every mesh now ships with a default #general topic auto-created on mesh
-- creation. This migration backfills the convention for meshes that
-- predate that hook:
--   1. Insert a #general row for every mesh that doesn't already have one.
--   2. Subscribe every active (non-revoked) member to #general.
--
-- Idempotent — safe to re-run. The unique indices on (mesh_id, name) and
-- (topic_id, member_id) make the inserts no-ops on the second pass.

-- mesh.topic.id has no Postgres-side default (drizzle's $defaultFn runs
-- only via the ORM), so generate a 32-char lowercase-hex id from a v4
-- UUID with dashes stripped. gen_random_uuid is built into Postgres 13+
-- so no pgcrypto extension required.
INSERT INTO mesh.topic (id, mesh_id, name, description, visibility)
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  m.id,
  'general',
  'Default mesh-wide channel. Every member can read and post.',
  'public'
FROM mesh.mesh m
WHERE m.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM mesh.topic t
    WHERE t.mesh_id = m.id AND t.name = 'general'
  );

INSERT INTO mesh.topic_member (topic_id, member_id, role)
SELECT
  t.id,
  mm.id,
  (CASE WHEN m.owner_user_id = mm.user_id THEN 'lead' ELSE 'member' END)::mesh.topic_member_role
FROM mesh.topic t
JOIN mesh.mesh m   ON m.id = t.mesh_id
JOIN mesh.member mm ON mm.mesh_id = t.mesh_id AND mm.revoked_at IS NULL
WHERE t.name = 'general'
ON CONFLICT (topic_id, member_id) DO NOTHING;
