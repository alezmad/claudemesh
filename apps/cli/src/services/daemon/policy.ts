/**
 * Per-process daemon policy — set once at CLI entry from --no-daemon /
 * --strict / env var, then read by daemon-routing helpers.
 *
 * Modes:
 *   "auto"       (default) probe → auto-spawn → retry → cold fallback
 *   "strict"     probe → auto-spawn → retry → ERROR (no cold fallback)
 *   "no-daemon"  skip daemon entirely → straight to cold path
 *
 * Env equivalents (for headless/CI use):
 *   CLAUDEMESH_STRICT_DAEMON=1   → strict
 *   CLAUDEMESH_NO_DAEMON=1       → no-daemon
 *
 * Flag wins over env when both are set.
 */

export type DaemonMode = "auto" | "strict" | "no-daemon";

export interface DaemonPolicy { mode: DaemonMode; }

let policy: DaemonPolicy = readEnvDefault();

function readEnvDefault(): DaemonPolicy {
  if (process.env.CLAUDEMESH_NO_DAEMON === "1") return { mode: "no-daemon" };
  if (process.env.CLAUDEMESH_STRICT_DAEMON === "1") return { mode: "strict" };
  return { mode: "auto" };
}

export function setDaemonPolicy(mode: DaemonMode): void {
  policy = { mode };
}

export function getDaemonPolicy(): DaemonPolicy {
  return policy;
}

/** Pick a mode from parsed flags. CLI flags win over env. */
export function policyFromFlags(flags: Record<string, unknown>): DaemonMode {
  if (flags["no-daemon"]) return "no-daemon";
  if (flags.strict) return "strict";
  return readEnvDefault().mode;
}
