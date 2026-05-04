// Try forwarding a send through the local daemon's IPC. Returns null if
// the daemon isn't running or the daemon's mesh doesn't match the target
// mesh — the caller falls back to the bridge or cold path.

import { existsSync } from "node:fs";

import { ipc } from "~/daemon/ipc/client.js";
import { DAEMON_PATHS } from "~/daemon/paths.js";

/** Try fetching the peer list through the daemon (~1ms warm IPC).
 *  Returns null when the daemon socket isn't present so the caller can
 *  fall back to bridge / cold paths. */
export async function tryListPeersViaDaemon(): Promise<unknown[] | null> {
  if (!existsSync(DAEMON_PATHS.SOCK_FILE)) return null;
  try {
    const res = await ipc<{ peers?: unknown[] }>({ path: "/v1/peers", timeoutMs: 3_000 });
    if (res.status !== 200) return null;
    return Array.isArray(res.body.peers) ? res.body.peers : [];
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

/** Try fetching mesh-published skills through the daemon. */
export async function tryListSkillsViaDaemon(): Promise<unknown[] | null> {
  if (!existsSync(DAEMON_PATHS.SOCK_FILE)) return null;
  try {
    const res = await ipc<{ skills?: unknown[] }>({ path: "/v1/skills", timeoutMs: 3_000 });
    if (res.status !== 200) return null;
    return Array.isArray(res.body.skills) ? res.body.skills : [];
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

/** Try fetching one skill body through the daemon. */
export async function tryGetSkillViaDaemon(name: string): Promise<unknown | null> {
  if (!existsSync(DAEMON_PATHS.SOCK_FILE)) return null;
  try {
    const res = await ipc<{ skill?: unknown }>({
      path: `/v1/skills/${encodeURIComponent(name)}`,
      timeoutMs: 3_000,
    });
    if (res.status === 404) return null;
    if (res.status !== 200) return null;
    return res.body.skill ?? null;
  } catch { return null; }
}

export type DaemonSendOk = {
  ok: true;
  messageId: string;
  duplicate?: boolean;
  status?: "queued" | "inflight";
};
export type DaemonSendErr = { ok: false; error: string };
export type DaemonSendResult = DaemonSendOk | DaemonSendErr;

export async function trySendViaDaemon(args: {
  to: string;
  message: string;
  priority: "now" | "next" | "low";
  /** Caller-stable id for cross-invocation idempotency. Optional. */
  idempotencyKey?: string;
  /** When set, only forward to the daemon if it's attached to this mesh.
   *  We can't query the daemon's mesh today (no IPC route exposes it),
   *  so for v0.9.0 this is informational; the caller already picked the
   *  right mesh by either flag or single-mesh-default. */
  expectedMesh?: string;
}): Promise<DaemonSendResult | null> {
  if (!existsSync(DAEMON_PATHS.SOCK_FILE)) return null;

  try {
    const res = await ipc<{
      client_message_id?: string;
      status?: "queued" | "inflight";
      broker_message_id?: string;
      duplicate?: boolean;
      error?: string;
    }>({
      method: "POST",
      path: "/v1/send",
      timeoutMs: 3_000,
      body: {
        to: args.to,
        message: args.message,
        priority: args.priority,
        ...(args.idempotencyKey ? { client_message_id: args.idempotencyKey } : {}),
      },
    });

    if (res.status === 202 || res.status === 200) {
      return {
        ok: true,
        messageId: res.body.broker_message_id ?? res.body.client_message_id ?? "",
        duplicate: res.body.duplicate,
        status: res.body.status,
      };
    }
    return { ok: false, error: res.body.error ?? `daemon http ${res.status}` };
  } catch (err) {
    // Connection errors → daemon went away mid-call. Treat as "not present"
    // so the caller falls back rather than failing.
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return { ok: false, error: msg };
  }
}
