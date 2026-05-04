// Daemon-routed CLI helpers. Returns null when the daemon is unreachable
// AND auto-spawn could not bring it up — caller is expected to fall back
// to its cold-path WS or to error out under `--strict`.
//
// Auto-recovery: when the daemon socket is missing or stale, every
// helper here calls into the lifecycle module which probes, spawns
// (under a lock), polls, and retries — so cold-path fallback only
// fires if auto-spawn failed. The lifecycle module caches its
// per-process result, so a script doing 50 sends pays the spawn cost
// at most once.
//
// 1.28.0: the orphaned bridge tier between daemon and cold paths was
// removed. Two paths only: daemon (with auto-spawn) → cold.

import { ipc } from "~/daemon/ipc/client.js";
import { ensureDaemonReady } from "~/services/daemon/lifecycle.js";
import { getDaemonPolicy } from "~/services/daemon/policy.js";
import { warnDaemonState } from "~/ui/warnings.js";

function meshQuery(mesh?: string): string {
  return mesh ? `?mesh=${encodeURIComponent(mesh)}` : "";
}

/** Common entry: ensure the daemon is reachable, emitting a one-shot
 *  stderr warning describing what we did. Returns true when the daemon
 *  is now reachable, false when the caller should fall back.
 *
 *  --no-daemon short-circuits to false; --strict's enforcement lives at
 *  the cold-path entry point (`withMesh` in commands/connect.ts) so a
 *  single chokepoint covers every verb. */
async function daemonReachable(): Promise<boolean> {
  const policy = getDaemonPolicy();
  if (policy.mode === "no-daemon") return false;
  const res = await ensureDaemonReady({ noAutoSpawn: false });
  warnDaemonState(res, {});
  return res.state === "up" || res.state === "started";
}

/** Try fetching the peer list through the daemon (~1ms warm IPC).
 *  Returns null when the daemon socket isn't present so the caller can
 *  fall back to bridge / cold paths. */
export async function tryListPeersViaDaemon(mesh?: string): Promise<unknown[] | null> {
  if (!(await daemonReachable())) return null;
  try {
    const res = await ipc<{ peers?: unknown[] }>({ path: `/v1/peers${meshQuery(mesh)}`, timeoutMs: 3_000 });
    if (res.status !== 200) return null;
    return Array.isArray(res.body.peers) ? res.body.peers : [];
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

/**
 * 1.34.0 — Try fetching the persisted inbox from the daemon.
 *
 * Reads from `~/.claudemesh/daemon/inbox.db` via `/v1/inbox`. This is
 * the authoritative source of received messages — pushes from the
 * broker land here through the daemon's session-WS / member-WS push
 * handler. The pre-1.34.0 cold-path inbox command opened a fresh
 * BrokerClient and drained an empty in-memory buffer, which never
 * matched what the daemon was actually receiving.
 */
export interface InboxItem {
  id: string;
  client_message_id: string;
  broker_message_id: string | null;
  mesh: string;
  topic: string | null;
  sender_pubkey: string;
  sender_name: string;
  body: string | null;
  received_at: string;
  reply_to_id: string | null;
  /** 1.34.8: ISO timestamp of when the row was first surfaced to the
   *  user (interactive listing or live channel reminder). `null` =
   *  never seen. */
  seen_at?: string | null;
}

export async function tryListInboxViaDaemon(
  mesh?: string,
  limit = 100,
  opts: { unreadOnly?: boolean; markSeen?: boolean } = {},
): Promise<InboxItem[] | null> {
  if (!(await daemonReachable())) return null;
  try {
    const params: string[] = [`limit=${limit}`];
    if (mesh) params.push(`mesh=${encodeURIComponent(mesh)}`);
    // 1.34.8: read-state filters. `unread_only=true` narrows to seen_at
    // IS NULL; `mark_seen=false` lets the caller peek without flipping
    // the seen flag (used by the welcome push on the MCP side, not the
    // CLI). Default behavior matches pre-1.34.8 — return everything
    // and stamp it seen — so existing callers keep working.
    if (opts.unreadOnly) params.push("unread_only=true");
    if (opts.markSeen === false) params.push("mark_seen=false");
    const path = `/v1/inbox?${params.join("&")}`;
    const res = await ipc<{ items?: InboxItem[] }>({ path, timeoutMs: 3_000 });
    if (res.status !== 200) return null;
    return Array.isArray(res.body.items) ? res.body.items : [];
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

/**
 * 1.34.7: bulk-delete inbox rows. `mesh` scopes to one mesh (omit =
 * across every attached mesh); `beforeIso` filters by `received_at <
 * Date.parse(beforeIso)`. Returns the number of rows removed, or null
 * when the daemon couldn't be reached.
 */
export async function tryFlushInboxViaDaemon(
  args: { mesh?: string; beforeIso?: string } = {},
): Promise<number | null> {
  if (!(await daemonReachable())) return null;
  try {
    const params: string[] = [];
    if (args.mesh)      params.push(`mesh=${encodeURIComponent(args.mesh)}`);
    if (args.beforeIso) params.push(`before=${encodeURIComponent(args.beforeIso)}`);
    const path = `/v1/inbox${params.length ? `?${params.join("&")}` : ""}`;
    const res = await ipc<{ removed?: number }>({ path, method: "DELETE", timeoutMs: 3_000 });
    if (res.status !== 200) return null;
    return typeof res.body.removed === "number" ? res.body.removed : null;
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

/** 1.34.7: delete one inbox row by id. Returns true iff the row was
 *  removed; false on 404; null on transport failure. */
export async function tryDeleteInboxRowViaDaemon(id: string): Promise<boolean | null> {
  if (!(await daemonReachable())) return null;
  try {
    const res = await ipc<{ removed?: number }>({
      path: `/v1/inbox/${encodeURIComponent(id)}`,
      method: "DELETE",
      timeoutMs: 3_000,
    });
    if (res.status === 404) return false;
    if (res.status !== 200) return null;
    return (res.body.removed ?? 0) > 0;
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

/** Try fetching mesh-published skills through the daemon. */
export async function tryListSkillsViaDaemon(mesh?: string): Promise<unknown[] | null> {
  if (!(await daemonReachable())) return null;
  try {
    const res = await ipc<{ skills?: unknown[] }>({ path: `/v1/skills${meshQuery(mesh)}`, timeoutMs: 3_000 });
    if (res.status !== 200) return null;
    return Array.isArray(res.body.skills) ? res.body.skills : [];
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

/** Try fetching one skill body through the daemon. */
export async function tryGetSkillViaDaemon(name: string, mesh?: string): Promise<unknown | null> {
  if (!(await daemonReachable())) return null;
  try {
    const res = await ipc<{ skill?: unknown }>({
      path: `/v1/skills/${encodeURIComponent(name)}${meshQuery(mesh)}`,
      timeoutMs: 3_000,
    });
    if (res.status === 404) return null;
    if (res.status !== 200) return null;
    return res.body.skill ?? null;
  } catch { return null; }
}

// --- state ---

export type StateEntry = {
  key: string;
  value: unknown;
  updatedBy: string;
  updatedAt: string;
  mesh?: string;
};

/** Try reading a single state key through the daemon. Returns:
 *   - the entry when the daemon found it
 *   - undefined when the daemon ran but the key is unset (404)
 *   - null when the daemon socket isn't present (caller falls back) */
export async function tryGetStateViaDaemon(key: string, mesh?: string): Promise<StateEntry | undefined | null> {
  if (!(await daemonReachable())) return null;
  try {
    const path = `/v1/state?key=${encodeURIComponent(key)}${mesh ? `&mesh=${encodeURIComponent(mesh)}` : ""}`;
    const res = await ipc<{ state?: StateEntry; error?: string }>({ path, timeoutMs: 3_000 });
    if (res.status === 404) return undefined;
    if (res.status !== 200) return null;
    return res.body.state ?? undefined;
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

export async function tryListStateViaDaemon(mesh?: string): Promise<StateEntry[] | null> {
  if (!(await daemonReachable())) return null;
  try {
    const res = await ipc<{ entries?: StateEntry[] }>({ path: `/v1/state${meshQuery(mesh)}`, timeoutMs: 3_000 });
    if (res.status !== 200) return null;
    return Array.isArray(res.body.entries) ? res.body.entries : [];
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

export async function trySetStateViaDaemon(key: string, value: unknown, mesh?: string): Promise<boolean> {
  if (!(await daemonReachable())) return false;
  try {
    const res = await ipc<{ ok?: boolean; error?: string }>({
      method: "POST",
      path: "/v1/state",
      timeoutMs: 3_000,
      body: { key, value, ...(mesh ? { mesh } : {}) },
    });
    return res.status === 200 && res.body.ok === true;
  } catch { return false; }
}

// --- memory ---

export type MemoryEntry = {
  id: string;
  content: string;
  tags: string[];
  rememberedBy: string;
  rememberedAt: string;
  mesh?: string;
};

export async function tryRememberViaDaemon(content: string, tags?: string[], mesh?: string): Promise<{ id: string; mesh?: string } | null> {
  if (!(await daemonReachable())) return null;
  try {
    const res = await ipc<{ id?: string; mesh?: string; error?: string }>({
      method: "POST",
      path: "/v1/memory",
      timeoutMs: 5_000,
      body: { content, ...(tags?.length ? { tags } : {}), ...(mesh ? { mesh } : {}) },
    });
    if (res.status !== 200 || !res.body.id) return null;
    return { id: res.body.id, mesh: res.body.mesh };
  } catch { return null; }
}

export async function tryRecallViaDaemon(query: string, mesh?: string): Promise<MemoryEntry[] | null> {
  if (!(await daemonReachable())) return null;
  try {
    const path = `/v1/memory?q=${encodeURIComponent(query)}${mesh ? `&mesh=${encodeURIComponent(mesh)}` : ""}`;
    const res = await ipc<{ matches?: MemoryEntry[] }>({ path, timeoutMs: 5_000 });
    if (res.status !== 200) return null;
    return Array.isArray(res.body.matches) ? res.body.matches : [];
  } catch (err) {
    const msg = String(err);
    if (/ENOENT|ECONNREFUSED|ipc_timeout/.test(msg)) return null;
    return null;
  }
}

export async function tryForgetViaDaemon(id: string, mesh?: string): Promise<boolean> {
  if (!(await daemonReachable())) return false;
  try {
    const path = `/v1/memory/${encodeURIComponent(id)}${meshQuery(mesh)}`;
    const res = await ipc<{ ok?: boolean }>({ method: "DELETE", path, timeoutMs: 3_000 });
    return res.status === 200 && res.body.ok === true;
  } catch { return false; }
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
  if (!(await daemonReachable())) return null;

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
        // v1.26.0 multi-mesh: forward the caller's chosen mesh so the
        // daemon picks the right broker. Omitting it on a single-mesh
        // daemon still works (auto-pick); omitting it on a multi-mesh
        // daemon returns 400 with the attached list.
        ...(args.expectedMesh ? { mesh: args.expectedMesh } : {}),
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
