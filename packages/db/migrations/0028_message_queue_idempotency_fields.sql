-- Daemon idempotency fields on message_queue (v0.9.0 daemon spec §4.2 / §4.4).
--
-- Adds two nullable columns so the daemon can attach its caller-supplied
-- `client_message_id` and the canonical `request_fingerprint` (sha256 hex
-- of the canonical request shape) to every send.
--
-- Both columns are nullable for backward compatibility — legacy traffic
-- from `claudemesh launch` and the dashboard chat doesn't carry them yet.
-- Sprint 7 (full broker hardening) will:
--   - add a partial unique index `(mesh_id, client_message_id) WHERE
--     client_message_id IS NOT NULL` once we're ready to enforce dedupe.
--   - introduce the `mesh.client_message_dedupe` table for atomic accept.
-- Until then, recording the values lets the broker echo them back on push
-- so daemon-side inboxes can dedupe correctly even with multiple senders.

ALTER TABLE "mesh"."message_queue"
  ADD COLUMN "client_message_id" text,
  ADD COLUMN "request_fingerprint" text;
