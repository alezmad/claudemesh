import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Daemon paths intentionally do NOT honor `CLAUDEMESH_CONFIG_DIR`.
 *
 * `claudemesh launch` sets `CLAUDEMESH_CONFIG_DIR` to a per-session
 * tmpdir so that joined-mesh state, last-used selections, and the
 * IPC session token stay isolated from the host's shared config.
 * The daemon, however, is a single per-machine process serving every
 * launched session — its socket, pid file, on-disk outbox, and SQLite
 * stores all live under `~/.claudemesh/daemon/`. Letting them inherit
 * the per-session tmpdir would point each CLI invocation inside a
 * launched session at a daemon socket that doesn't exist, force the
 * cold path, and surface as "service-managed daemon not responding
 * within 8000ms" (1.31.0 regression observed in real install).
 *
 * `CLAUDEMESH_DAEMON_DIR` exists as an explicit override for tests
 * and for the rare case of running multiple daemon instances side by
 * side (e.g. integration tests). Production callers should never set
 * it.
 */
const DAEMON_DIR_ROOT =
  process.env.CLAUDEMESH_DAEMON_DIR || join(homedir(), ".claudemesh", "daemon");

export const DAEMON_PATHS = {
  get DAEMON_DIR() { return DAEMON_DIR_ROOT; },
  get PID_FILE()    { return join(this.DAEMON_DIR, "daemon.pid"); },
  get SOCK_FILE()   { return join(this.DAEMON_DIR, "daemon.sock"); },
  get TOKEN_FILE()  { return join(this.DAEMON_DIR, "local-token"); },
  get OUTBOX_DB()   { return join(this.DAEMON_DIR, "outbox.db"); },
  get INBOX_DB()    { return join(this.DAEMON_DIR, "inbox.db"); },
  get LOG_FILE()    { return join(this.DAEMON_DIR, "daemon.log"); },
} as const;

export const DAEMON_TCP_HOST = "127.0.0.1";
export const DAEMON_TCP_DEFAULT_PORT = 47823;
