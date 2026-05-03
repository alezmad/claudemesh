import { join } from "node:path";

import { PATHS } from "~/constants/paths.js";

export const DAEMON_PATHS = {
  get DAEMON_DIR() { return join(PATHS.CONFIG_DIR, "daemon"); },
  get PID_FILE()    { return join(this.DAEMON_DIR, "daemon.pid"); },
  get SOCK_FILE()   { return join(this.DAEMON_DIR, "daemon.sock"); },
  get TOKEN_FILE()  { return join(this.DAEMON_DIR, "local-token"); },
  get OUTBOX_DB()   { return join(this.DAEMON_DIR, "outbox.db"); },
  get INBOX_DB()    { return join(this.DAEMON_DIR, "inbox.db"); },
  get LOG_FILE()    { return join(this.DAEMON_DIR, "daemon.log"); },
} as const;

export const DAEMON_TCP_HOST = "127.0.0.1";
export const DAEMON_TCP_DEFAULT_PORT = 47823;
