/**
 * `claudemesh send <to> <message>` — send a message to a peer or group.
 *
 * <to> can be:
 *   - a display name  ("Mou")
 *   - a pubkey hex    ("abc123...")
 *   - @group          ("@flexicar")
 *   - *               (broadcast to all)
 *
 * Warm path: dials the per-mesh bridge socket the push-pipe holds open
 * (~5ms). Cold path: opens its own WS via `withMesh` (~300-700ms).
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { trySendViaDaemon } from "~/services/bridge/daemon-route.js";
import type { Priority } from "~/services/broker/facade.js";
import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";

export interface SendFlags {
  mesh?: string;
  priority?: string;
  json?: boolean;
  /** Allow sending to a target that resolves to one of the caller's
   * own sessions. Off by default — trying to message your own
   * sibling session is almost always an accident (copying a hex
   * pubkey from `peer list` without realizing it was your own row). */
  self?: boolean;
}

export async function runSend(flags: SendFlags, to: string, message: string): Promise<void> {
  if (!to || !message) {
    render.err("Usage: claudemesh send <to> <message>");
    process.exit(1);
  }

  const priority: Priority =
    flags.priority === "now" ? "now"
    : flags.priority === "low" ? "low"
    : "next";

  // Resolve which mesh to use. With --mesh, target it directly.
  // Without, use first joined mesh — same default as withMesh.
  const config = readConfig();
  const meshSlug =
    flags.mesh ??
    (config.meshes.length === 1 ? config.meshes[0]!.slug : null);

  // 1.31.6: hex-prefix resolution. If `to` looks like hex but isn't a
  // full 64-char pubkey, resolve it against the peer list and replace
  // it with the matching full pubkey. The broker stores `targetSpec`
  // verbatim and the drain query at apps/broker/src/broker.ts:2408
  // matches only on full pubkeys, so a 16-hex prefix would queue
  // successfully but never fetch — sender saw "sent", recipient saw
  // nothing. Resolving here makes the CLI's prefix UX work end-to-end
  // and surfaces ambiguous / unmatched prefixes with a clear error
  // instead of a silent drop.
  if (
    !to.startsWith("@") &&
    !to.startsWith("#") &&
    to !== "*" &&
    /^[0-9a-f]{4,63}$/i.test(to)
  ) {
    try {
      const { tryListPeersViaDaemon } = await import("~/services/bridge/daemon-route.js");
      const peers = (await tryListPeersViaDaemon()) ?? [];
      const lower = to.toLowerCase();
      const matches = peers.filter((p) => {
        const pk = (p as { pubkey?: string }).pubkey ?? "";
        const mpk = (p as { memberPubkey?: string }).memberPubkey ?? "";
        return pk.toLowerCase().startsWith(lower) || mpk.toLowerCase().startsWith(lower);
      });
      if (matches.length === 0) {
        render.err(`No peer matches hex prefix "${to}".`);
        const names = peers
          .map((p) => (p as { displayName?: string }).displayName)
          .filter(Boolean)
          .join(", ");
        if (names) render.hint(`online: ${names}`);
        process.exit(1);
      }
      if (matches.length > 1) {
        const candidates = matches
          .map((p) => {
            const pk = (p as { pubkey?: string }).pubkey ?? "";
            const dn = (p as { displayName?: string }).displayName ?? "?";
            return `${dn} ${pk.slice(0, 16)}…`;
          })
          .join(", ");
        render.err(`Ambiguous hex prefix "${to}" — matches ${matches.length} peers.`);
        render.hint(`candidates: ${candidates}`);
        render.hint("Use a longer prefix or paste the full 64-char pubkey.");
        process.exit(1);
      }
      to = (matches[0] as { pubkey?: string }).pubkey ?? to;
    } catch {
      // Daemon unreachable — fall through; cold path will try a name
      // lookup and surface its own error if that also fails.
    }
  }

  // Self-DM safety check: if target is a 64-char hex that matches the
  // caller's own member pubkey (or any of the caller's session/member
  // entries), refuse without --self. Catches the common pasted-from-
  // peer-list-not-realizing-it-was-mine footgun.
  if (!flags.self && meshSlug) {
    const joined = config.meshes.find((m) => m.slug === meshSlug);
    if (joined && /^[0-9a-f]{64}$/i.test(to) && to.toLowerCase() === joined.pubkey.toLowerCase()) {
      render.err(
        `Target "${to.slice(0, 16)}…" is your own member pubkey on mesh "${meshSlug}".`,
      );
      render.hint(
        "Pass --self to message a sibling session of your own member, or pick a different peer's pubkey.",
      );
      process.exit(1);
    }
  }

  // Daemon path — preferred when a long-lived daemon is local. UDS at
  // ~/.claudemesh/daemon/daemon.sock; ~1ms round-trip; persists outbox
  // across CLI invocations so a `claudemesh send` survives a daemon
  // crash via the on-disk outbox.
  {
    const dr = await trySendViaDaemon({ to, message, priority, expectedMesh: meshSlug ?? undefined });
    if (dr !== null) {
      if (dr.ok) {
        if (flags.json) console.log(JSON.stringify({ ok: true, messageId: dr.messageId, target: to, via: "daemon", duplicate: !!dr.duplicate }));
        else render.ok(`sent to ${to} (daemon)`, dr.messageId ? dim(dr.messageId.slice(0, 8)) : undefined);
        return;
      }
      // Daemon answered but rejected (409 idempotency, 400 schema). Surface; do not fall through.
      if (flags.json) console.log(JSON.stringify({ ok: false, error: dr.error, via: "daemon" }));
      else render.err(`send failed (daemon): ${dr.error}`);
      process.exit(1);
    }
    // dr === null → daemon not running and lifecycle couldn't auto-
    // spawn it; fall through to cold path. The orphaned bridge tier
    // was removed in 1.28.0.
  }

  // Cold path — open our own WS, encrypt locally, fire envelope.
  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    let targetSpec = to;
    if (to.startsWith("#") && !/^#[0-9a-z_-]{20,}$/i.test(to)) {
      // Topic by name → resolve to "#<topicId>" via topicList. The broker
      // wire format is "#<topicId>"; users type "#<name>" for ergonomics.
      const name = to.slice(1);
      const topics = await client.topicList();
      const match = topics.find((t) => t.name === name);
      if (!match) {
        const names = topics.map((t) => "#" + t.name).join(", ");
        render.err(`Topic "${to}" not found.`, `topics: ${names || "(none)"}`);
        process.exit(1);
      }
      targetSpec = "#" + match.id;
    } else if (!to.startsWith("@") && !to.startsWith("#") && to !== "*" && !/^[0-9a-f]{64}$/i.test(to)) {
      const peers = await client.listPeers();
      const match = peers.find(
        (p) => p.displayName.toLowerCase() === to.toLowerCase(),
      );
      if (!match) {
        const names = peers.map((p) => p.displayName).join(", ");
        render.err(`Peer "${to}" not found.`, `online: ${names || "(none)"}`);
        process.exit(1);
      }
      targetSpec = match.pubkey;
    }

    const result = await client.send(targetSpec, message, priority);
    if (result.ok) {
      if (flags.json) {
        console.log(JSON.stringify({ ok: true, messageId: result.messageId, target: to }));
      } else {
        render.ok(`sent to ${to}`, result.messageId ? dim(result.messageId.slice(0, 8)) : undefined);
      }
    } else {
      if (flags.json) {
        console.log(JSON.stringify({ ok: false, error: result.error ?? "unknown" }));
      } else {
        render.err(`send failed: ${result.error ?? "unknown error"}`);
      }
      process.exit(1);
    }
  });
}
