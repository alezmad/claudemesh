/**
 * Re-attach a launched session to the daemon when its registration is
 * missing — spec 2026-09-26 §2 (bug1).
 *
 * `claudemesh launch` registers the session, but the registration was
 * anchored on the WRAPPER's pid and its token lived in the wrapper's
 * tmpdir. When claude outlived the wrapper (restart, re-exec, resume) the
 * reaper dropped the entry, the token file vanished, and every send from
 * that session silently went out under the MEMBER key — so replies fanned
 * out to all of the member's sessions.
 *
 * The session's own processes (its MCP server at startup, `claudemesh
 * send`, `claudemesh session reattach`) call `ensureSessionRegistered`,
 * which re-registers with the SAME persisted keypair (never a new one)
 * and the same stable token, anchored on claude's pid.
 */

import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { execFileSync } from "node:child_process";

import { ipc } from "~/daemon/ipc/client.js";
import { readConfig } from "~/services/config/facade.js";
import { signParentAttestation } from "~/services/broker/session-hello-sig.js";
import { findSessionMesh, loadOrCreateSessionKeypair, sessionTokenPath } from "./keypair-store.js";
import { mintSessionToken, readSessionTokenFromEnv } from "./token.js";

export type ReattachOutcome =
  | { kind: "registered" }                 // already known to the daemon
  | { kind: "reattached"; mesh: string }   // we re-registered it
  | { kind: "not_a_session" }              // not inside a launched session
  | { kind: "failed"; reason: string };

/** Walk up from `start` to the nearest `claude` process. That pid is what
 *  the registry must watch: a Bash-tool subprocess dies in milliseconds. */
export function findClaudeAncestorPid(start: number = process.ppid): number | null {
  let pid = start;
  for (let hops = 0; hops < 12 && pid > 1; hops++) {
    let line = "";
    try {
      line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
    } catch { return null; }
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m) return null;
    const comm = m[2]!.trim();
    if (/(^|\/)claude$/.test(comm)) return pid;
    pid = Number(m[1]);
  }
  return null;
}

export async function ensureSessionRegistered(opts: {
  /** Pid to anchor liveness on (claude's). */
  pid: number;
  env?: NodeJS.ProcessEnv;
  /** Re-register even when the daemon already knows the token — used by
   *  the MCP at startup to move the anchor from the wrapper to claude. */
  refreshPid?: boolean;
}): Promise<ReattachOutcome> {
  const env = opts.env ?? process.env;
  const sessionId = env.CLAUDEMESH_SESSION_ID;
  const displayName = env.CLAUDEMESH_DISPLAY_NAME;
  if (!sessionId || !displayName) return { kind: "not_a_session" };

  const config = readConfig();
  const meshSlug =
    env.CLAUDEMESH_MESH_SLUG ||
    findSessionMesh(sessionId) ||
    (config.meshes.length === 1 ? config.meshes[0]!.slug : null);
  if (!meshSlug) return { kind: "failed", reason: "can't tell which mesh this session belongs to (set --mesh)" };
  const mesh = config.meshes.find((m) => m.slug === meshSlug);
  if (!mesh) return { kind: "failed", reason: `mesh "${meshSlug}" isn't joined on this machine` };

  let token = readSessionTokenFromEnv(env);
  if (token && !opts.refreshPid) {
    try {
      const me = await ipc<{ session?: unknown }>({ path: "/v1/sessions/me", timeoutMs: 1_500 });
      if (me.status === 200 && me.body.session) return { kind: "registered" };
    } catch (e) {
      return { kind: "failed", reason: `daemon unreachable: ${String(e)}` };
    }
  }

  if (!token) {
    const path = sessionTokenPath(meshSlug, sessionId);
    if (!path) return { kind: "failed", reason: `unusable session id "${sessionId}"` };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    token = mintSessionToken(dirname(path), basename(path)).token;
  }

  const kp = await loadOrCreateSessionKeypair(meshSlug, sessionId);
  const att = await signParentAttestation({
    parentMemberPubkey: mesh.pubkey,
    parentSecretKey: mesh.secretKey,
    sessionPubkey: kp.publicKey,
  });
  try {
    const res = await ipc<{ ok?: boolean; error?: string }>({
      method: "POST",
      path: "/v1/sessions/register",
      timeoutMs: 3_000,
      body: {
        token,
        session_id: sessionId,
        mesh: meshSlug,
        display_name: displayName,
        pid: opts.pid,
        cwd: process.cwd(),
        ...(env.CLAUDEMESH_ROLE ? { role: env.CLAUDEMESH_ROLE } : {}),
        presence: {
          session_pubkey: kp.publicKey,
          session_secret_key: kp.secretKey,
          parent_attestation: {
            session_pubkey: att.sessionPubkey,
            parent_member_pubkey: att.parentMemberPubkey,
            expires_at: att.expiresAt,
            signature: att.signature,
          },
        },
      },
    });
    if (res.status !== 200) return { kind: "failed", reason: res.body.error ?? `daemon http ${res.status}` };
  } catch (e) {
    return { kind: "failed", reason: `daemon unreachable: ${String(e)}` };
  }
  return { kind: "reattached", mesh: meshSlug };
}
