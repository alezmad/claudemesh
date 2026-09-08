-- 2026-09-08 daemon-restart mesh blackout, RC-B (spec:
-- .artifacts/specs/2026-09-08-daemon-restart-mesh-blackout.md, Addendum 5).
--
-- mesh.presence had 2.49 M rows and no index beyond the PK. Every hot
-- query filters on `disconnected_at IS NULL` (13 rows online) and was
-- full-scanning the table:
--   * sweepStalePresences  — every 30 s: WHERE disconnected_at IS NULL AND last_ping_at < cutoff
--   * listPeersInMesh      — JOIN member … WHERE disconnected_at IS NULL
--   * handleHookSetStatus  — WHERE cwd = ? AND disconnected_at IS NULL
--   * heartbeat / restorePresence / disconnectPresence — by PK (fine)
-- Under a reconnect storm those scans pushed hello latency to ~5 s.
--
-- Partial indexes keep only the online rows (tiny) so each of those
-- queries is an index scan regardless of table size. The plain index on
-- disconnected_at serves the new retention sweep (delete rows disconnected
-- > 30 d ago in batches).
--
-- Plain CREATE INDEX (not CONCURRENTLY): the migration runner wraps each
-- file in a transaction, and CONCURRENTLY cannot run inside one. On the
-- 2.5 M-row prod table these three builds take a few seconds each and
-- block writes to presence for that window; heartbeats retry on the next
-- pong, so this is acceptable for a one-time build.

CREATE INDEX IF NOT EXISTS presence_online_member_idx
  ON mesh.presence (member_id)
  WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS presence_online_last_ping_idx
  ON mesh.presence (last_ping_at)
  WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS presence_online_cwd_idx
  ON mesh.presence (cwd)
  WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS presence_disconnected_at_idx
  ON mesh.presence (disconnected_at)
  WHERE disconnected_at IS NOT NULL;
