/**
 * `claudemesh session reattach` — restore this session's daemon
 * registration after claude restarted or was resumed outside the launch
 * wrapper (spec 2026-09-26 §2, bug1). Keeps the session's persisted key,
 * so peers holding its pubkey can still reach it.
 */

import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";

export async function runSessionReattach(flags: { mesh?: string; json?: boolean }): Promise<number> {
  const { ensureSessionRegistered, findClaudeAncestorPid } = await import("~/services/session/reattach.js");
  const env = flags.mesh ? { ...process.env, CLAUDEMESH_MESH_SLUG: flags.mesh } : process.env;
  const pid = findClaudeAncestorPid() ?? process.ppid;
  const outcome = await ensureSessionRegistered({ pid, env, refreshPid: true });
  if (flags.json) {
    console.log(JSON.stringify({ ...outcome, pid }));
    return outcome.kind === "failed" || outcome.kind === "not_a_session" ? 1 : 0;
  }
  switch (outcome.kind) {
    case "not_a_session":
      render.err("Not inside a claudemesh-launched session (CLAUDEMESH_SESSION_ID / CLAUDEMESH_DISPLAY_NAME unset).");
      return 1;
    case "failed":
      render.err(`reattach failed: ${outcome.reason}`);
      return 1;
    case "registered":
      render.ok("session already registered", dim(`pid ${pid}`));
      return 0;
    case "reattached":
      render.ok(`session re-attached on "${outcome.mesh}"`, dim(`pid ${pid}`));
      return 0;
  }
}
