-- Per-peer capability grants on mesh membership.
--
-- Spec: .artifacts/specs/2026-04-15-per-peer-capabilities.md
--
-- Adds a jsonb column to mesh_member tracking which peers may send what
-- kind of messages to this member. Shape:
--   { "<peer_pubkey_hex>": ["dm", "broadcast", "state-read", ...] }
--
-- Default = empty object, meaning "use the global default set"
-- (read + dm + broadcast + state-read). Explicit empty array for a
-- specific peer = blocked.
--
-- Enforcement lives in the broker's message router — before queueing an
-- encrypted blob for a recipient, check peer_grants to see if the sender
-- has the relevant capability. Silent drop on denial (Signal block
-- semantics — sender's delivery receipt succeeds, recipient sees nothing).
--
-- Additive + nullable → safe to deploy before CLI knows about it.

ALTER TABLE "mesh"."member"
  ADD COLUMN IF NOT EXISTS "peer_grants" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- GIN index for fast existence checks: does this member have any grant
-- entry for this sender pubkey? Used on every message-send hot path.
CREATE INDEX IF NOT EXISTS "member_peer_grants_gin_idx"
  ON "mesh"."member"
  USING gin ("peer_grants");
