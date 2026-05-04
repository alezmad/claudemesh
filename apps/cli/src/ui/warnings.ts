/**
 * Once-per-process daemon-state warnings, routed to stderr.
 *
 * Suppressed under --quiet (caller responsibility — we never inspect
 * argv). JSON callers should consult the result's `state` field
 * directly and skip calling this helper.
 */

import type { EnsureDaemonResult } from "~/services/daemon/lifecycle.js";
import { getDaemonPolicy } from "~/services/daemon/policy.js";
import { dim } from "./styles.js";

let alreadyWarned = false;

export interface WarnDaemonOpts {
  quiet?: boolean;
  /** When true, emit nothing — the caller will surface the state in JSON. */
  json?: boolean;
}

/** Print a single, severity-appropriate line to stderr describing the
 *  result of `ensureDaemonReady`. Returns whether anything was printed. */
export function warnDaemonState(
  res: EnsureDaemonResult,
  opts: WarnDaemonOpts = {},
): boolean {
  if (alreadyWarned) return false;
  if (opts.quiet || opts.json) return false;
  if (res.state === "up") return false;

  // Under --strict, the cold-path gate at `withMesh` will print its own
  // refusal message — suppress the misleading "using cold path" hint
  // here so the user sees a single, accurate error.
  if (getDaemonPolicy().mode === "strict" && res.state !== "started") return false;

  alreadyWarned = true;
  const tag = (label: string) => `[claudemesh] ${label}`;
  const hint = (s: string) => dim(s);

  switch (res.state) {
    case "started":
      process.stderr.write(`${tag("info")} daemon restarted automatically ${hint(`(took ${res.durationMs}ms)`)}\n`);
      return true;
    case "down":
      process.stderr.write(`${tag("info")} daemon not running — using cold path ${hint("(slower; run `claudemesh daemon up` for warm path)")}\n`);
      return true;
    case "spawn-suppressed":
      process.stderr.write(`${tag("warn")} ${res.reason ?? "daemon failed to start recently"} — using cold path ${hint("(run `claudemesh doctor`)")}\n`);
      return true;
    case "spawn-failed":
      process.stderr.write(`${tag("warn")} daemon spawn failed${res.reason ? `: ${res.reason}` : ""} — using cold path ${hint("(check ~/.claudemesh/daemon/daemon.log)")}\n`);
      return true;
  }
  return false;
}

/** Reset the once-per-process latch. Test helper. */
export function _resetDaemonWarningLatch(): void {
  alreadyWarned = false;
}
