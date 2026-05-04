-- Milestone 1 (v2 agentic-comms architecture).
--
-- Two concerns rolled into one migration because both are tiny and both
-- ship together with the broker change in the same PR:
--
-- 1. message_queue claim/lease columns (drainForMember race fix)
--    --------------------------------------------------------------
--    Before this migration, drainForMember claimed rows by setting
--    `delivered_at = NOW()` inside the same UPDATE that selected them.
--    If the recipient WS was closed between claim-time and ws.send(),
--    the message was silently dropped — the row read as "delivered" so
--    the next reconnect's drain skipped it. At-most-once semantics with
--    no retry hook.
--
--    The fix moves to two-phase claim/deliver with a lease:
--      claimed_at       — set when drainForMember picks the row
--      claim_id         — presenceId of the claimer (debugging)
--      claim_expires_at — claimed_at + 30s; if no `client_ack` lands by
--                         then, a sweeper clears the claim and the row
--                         is re-eligible for a new drain (at-least-once).
--
--    `delivered_at` only gets set when the recipient WS replies with a
--    `client_ack` containing the original client_message_id. Until any
--    daemon emits `client_ack`, claims will simply expire and re-deliver
--    — which is the desired retry behaviour for unreliable transports.
--
-- 2. presence.role column
--    --------------------------------------------------------------
--    The CLI currently hides daemon connections from `peer list` by
--    matching `peerType === 'claudemesh-daemon'`, which is fragile and
--    overloads a free-form field. M1 introduces a typed `role` column on
--    presence with three documented values:
--      'control-plane' — long-lived daemon WS (one per host)
--      'session'       — per-Claude-Code-session WS (default)
--      'service'       — autonomous bots/services attached to a mesh
--
--    Backfilled to 'session' (default) so legacy presence rows keep their
--    existing visibility. The two hello paths in the broker pass
--    'control-plane' / 'session' explicitly. CLI-side filter swap
--    (peerType -> role) is a follow-up worktree.

ALTER TABLE "mesh"."message_queue"
  ADD COLUMN "claimed_at" timestamp,
  ADD COLUMN "claim_id" text,
  ADD COLUMN "claim_expires_at" timestamp;

ALTER TABLE "mesh"."presence"
  ADD COLUMN "role" text NOT NULL DEFAULT 'session';
