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

  // Resolve which mesh to use. With --mesh, target it directly. Without,
  // use the only joined mesh, else leave null and let target resolution
  // below discover the right mesh from where the peer actually lives.
  const config = readConfig();
  let meshSlug =
    flags.mesh ??
    (config.meshes.length === 1 ? config.meshes[0]!.slug : null);

  // Cross-mesh target resolution (1.36.0). A direct send to a hex prefix
  // or display name is resolved against the peer rosters so the CLI:
  //   - expands a prefix/name to the full session pubkey (the broker's
  //     drain matches only full pubkeys — a bare prefix would queue but
  //     never fetch: sender saw "sent", recipient saw nothing);
  //   - DISCOVERS which joined mesh the target is on when no --mesh was
  //     given and several meshes are joined. Previously this returned
  //     `mesh_required` and a live peer on a non-default mesh looked
  //     "disconnected". We now scan every joined mesh's roster and, if
  //     the target resolves in exactly one, auto-select that mesh.
  // With --mesh (or a single joined mesh) the scan is scoped to that one
  // mesh, so `send --mesh X <prefix>` resolves against X's roster — not
  // the default mesh (the bug where only the full 64-char pubkey worked).
  const isDirect = !to.startsWith("@") && !to.startsWith("#") && to !== "*";
  const isFullPubkey = /^[0-9a-f]{64}$/i.test(to);
  const isPrefix = /^[0-9a-f]{4,63}$/i.test(to);
  const isName = isDirect && !isFullPubkey && !isPrefix;

  if (isDirect && (isPrefix || isName || (isFullPubkey && !meshSlug))) {
    const { tryListPeersViaDaemon } = await import("~/services/bridge/daemon-route.js");
    const searchSlugs = meshSlug ? [meshSlug] : config.meshes.map((m) => m.slug);
    const lower = to.toLowerCase();
    let daemonReachable = false;
    type Hit = { slug: string; pubkey: string; displayName: string };
    const matches: Hit[] = [];
    for (const slug of searchSlugs) {
      const peers = await tryListPeersViaDaemon(slug);
      if (peers === null) continue; // daemon unreachable for this query
      daemonReachable = true;
      for (const p of peers) {
        // Never resolve a name/prefix to a control-plane daemon row — it's
        // infrastructure, not an addressable peer, and matching it sends a
        // DM that the daemon swallows. (peerRole is the reliable marker;
        // the daemon's own row is control-plane.)
        if ((p as { peerRole?: string }).peerRole === "control-plane") continue;
        const pk = ((p as { pubkey?: string }).pubkey ?? "").toLowerCase();
        const mpk = ((p as { memberPubkey?: string }).memberPubkey ?? "").toLowerCase();
        const dn = (p as { displayName?: string }).displayName ?? "?";
        const hit = isName
          ? dn.toLowerCase() === lower
          : pk.startsWith(lower) || mpk.startsWith(lower);
        if (hit) matches.push({ slug, pubkey: (p as { pubkey?: string }).pubkey ?? "", displayName: dn });
      }
    }

    // Only act on a reachable daemon. If it was down for every query, fall
    // through to the cold path, which opens its own WS and resolves names.
    if (daemonReachable) {
      const byPubkey = new Map<string, Hit>();
      for (const m of matches) if (!byPubkey.has(m.pubkey)) byPubkey.set(m.pubkey, m);
      const uniq = [...byPubkey.values()];
      const meshesHit = [...new Set(uniq.map((m) => m.slug))];

      if (uniq.length === 0) {
        // For a full pubkey we couldn't locate, keep going — the user gave
        // a complete key and the daemon send will surface a clear error.
        if (!isFullPubkey) {
          render.err(`No peer matches "${to}"${flags.mesh ? ` on mesh "${flags.mesh}"` : " on any joined mesh"}.`);
          render.hint("Check `claudemesh peer list` (add --mesh <slug> to scope).");
          process.exit(1);
        }
      } else if (uniq.length > 1) {
        if (meshesHit.length > 1 && !meshSlug) {
          // Target lives on several meshes — disambiguate by mesh, not prefix.
          const where = uniq
            .map((m) => `${m.displayName} ${m.pubkey.slice(0, 12)}… @${m.slug}`)
            .join(", ");
          render.err(`"${to}" matches peers on ${meshesHit.length} meshes — pick one with --mesh <slug>.`);
          render.hint(`candidates: ${where}`);
          process.exit(1);
        }
        const candidates = uniq
          .map((m) => `${m.displayName} ${m.pubkey.slice(0, 16)}…`)
          .join(", ");
        render.err(`Ambiguous ${isName ? "name" : "prefix"} "${to}" — matches ${uniq.length} peers.`);
        render.hint(`candidates: ${candidates}`);
        render.hint("Use a longer prefix or paste the full 64-char pubkey.");
        process.exit(1);
      } else {
        // Exactly one match — adopt its mesh (P1: kills mesh_required for
        // peers on a non-default mesh) and its full pubkey (prefix/name).
        meshSlug = uniq[0]!.slug;
        if (!isFullPubkey) to = uniq[0]!.pubkey;
      }
    }
  }

  // Self-DM safety check: if target is a 64-char hex that matches the
  // caller's own member pubkey, refuse without --self. Catches the
  // common pasted-from-peer-list-not-realizing-it-was-mine footgun.
  // With --self, member-pubkey targeting fans out to every connected
  // sibling session of your member (the broker's drain only matches
  // exact session pubkeys, so we resolve here in the CLI).
  if (meshSlug) {
    const joined = config.meshes.find((m) => m.slug === meshSlug);
    const isOwnMemberKey =
      joined && /^[0-9a-f]{64}$/i.test(to) && to.toLowerCase() === joined.pubkey.toLowerCase();

    if (isOwnMemberKey && !flags.self) {
      render.err(
        `Target "${to.slice(0, 16)}…" is your own member pubkey on mesh "${meshSlug}".`,
      );
      render.hint(
        "Pass --self to message a sibling session of your own member, or pick a different peer's pubkey.",
      );
      process.exit(1);
    }

    if (isOwnMemberKey && flags.self) {
      // Member-pubkey fan-out: resolve to every connected sibling
      // session pubkey and send one message per recipient. Required
      // because the broker's drain query at apps/broker/src/broker.ts
      // matches target_spec only against full session pubkeys —
      // sending to a member pubkey would queue successfully but no
      // drain would fetch.
      try {
        const { tryListPeersViaDaemon } = await import("~/services/bridge/daemon-route.js");
        const { getSessionInfo } = await import("~/services/session/resolve.js");
        const peers = (await tryListPeersViaDaemon()) ?? [];
        const session = await getSessionInfo();
        const ownSessionPk = session?.presence?.sessionPubkey?.toLowerCase();
        const siblings = peers.filter((p) => {
          const r = p as { memberPubkey?: string; pubkey?: string; channel?: string; peerRole?: string };
          if (!r.pubkey) return false;
          if (ownSessionPk && r.pubkey.toLowerCase() === ownSessionPk) return false;
          // Exclude the daemon's own control-plane presence row. peerRole is
          // the reliable marker (the live daemon row is control-plane even
          // when its channel reads "claudemesh-session"); keep the channel
          // check too for older brokers that don't emit peerRole.
          if (r.peerRole === "control-plane" || r.channel === "claudemesh-daemon") return false;
          return r.memberPubkey?.toLowerCase() === to.toLowerCase();
        });
        if (siblings.length === 0) {
          render.err(`--self fan-out: no other sibling sessions of your member online.`);
          process.exit(1);
        }
        const results: Array<{ pubkey: string; ok: boolean; messageId?: string; error?: string }> = [];
        for (const peer of siblings) {
          const pk = (peer as { pubkey: string }).pubkey;
          const dr = await trySendViaDaemon({ to: pk, message, priority, expectedMesh: meshSlug ?? undefined });
          if (dr === null) {
            results.push({ pubkey: pk, ok: false, error: "daemon path unavailable" });
            continue;
          }
          if (dr.ok) {
            results.push({
              pubkey: pk,
              ok: true,
              ...(dr.messageId ? { messageId: dr.messageId } : {}),
            });
          } else {
            results.push({ pubkey: pk, ok: false, error: dr.error });
          }
        }
        const okCount = results.filter((r) => r.ok).length;
        if (flags.json) {
          console.log(JSON.stringify({ ok: okCount > 0, fanout: results, via: "daemon" }));
        } else if (okCount === results.length) {
          render.ok(`fanned out to ${okCount} sibling session${okCount === 1 ? "" : "s"} (daemon)`);
          for (const r of results) render.info(dim(`  → ${r.pubkey.slice(0, 16)}… ${r.messageId ? dim(r.messageId.slice(0, 8)) : ""}`));
        } else {
          render.warn(`fanned out: ${okCount}/${results.length} delivered`);
          for (const r of results) {
            const tag = r.ok ? "✔" : "✘";
            render.info(`  ${tag} ${r.pubkey.slice(0, 16)}… ${r.error ? dim(`— ${r.error}`) : ""}`);
          }
        }
        return;
      } catch (e) {
        render.err(`--self fan-out failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    }
  }

  // --self only governs the own-member-key fan-out above, which returns
  // early. Reaching here with --self still set means the target was NOT
  // your own member pubkey, so the flag did nothing. Say so rather than
  // ignoring it silently — the old behavior made `send --self <session-
  // pubkey>` look like it controlled routing when it was inert. Messaging
  // a specific session pubkey (including one of your own sibling sessions)
  // needs no flag and just works.
  if (flags.self) {
    render.warn("--self had no effect: it only applies when the target is your own member pubkey (fan-out to your sibling sessions). Sending to this specific pubkey directly.");
  }

  // Honest-delivery pre-check (direct sends only). The daemon path below
  // queues into the local outbox and returns `queued` optimistically; the
  // drain then delivers async and retries failures (incl. "no connected
  // peer") forever. So a bare "sent" line was misleading — a DM to an
  // offline or stale-session-key target looked delivered but never was.
  // Resolve the live roster once to learn whether `to` is addressable
  // right now; this only shapes the confirmation wording (the send still
  // queues regardless, preserving store-and-forward for genuinely-offline
  // peers). null = unknown (not a direct DM, or daemon unreachable).
  let recipientOnline: boolean | null = null;
  let recipientName: string | undefined;
  if (isDirect && meshSlug) {
    const { tryListPeersViaDaemon } = await import("~/services/bridge/daemon-route.js");
    const peers = await tryListPeersViaDaemon(meshSlug);
    if (peers !== null) {
      const lower = to.toLowerCase();
      const match = peers.find((p) => {
        const r = p as { pubkey?: string; memberPubkey?: string; peerRole?: string };
        if (r.peerRole === "control-plane") return false;
        return r.pubkey?.toLowerCase() === lower || r.memberPubkey?.toLowerCase() === lower;
      });
      recipientOnline = !!match;
      recipientName = match ? (match as { displayName?: string }).displayName : undefined;
    }
  }
  const offlineHint =
    "Session pubkeys are ephemeral — a key from an ended session never reconnects, so the message can't be delivered. Re-fetch a live target with `claudemesh peer list --json`.";

  // Daemon path — preferred when a long-lived daemon is local. UDS at
  // ~/.claudemesh/daemon/daemon.sock; ~1ms round-trip; persists outbox
  // across CLI invocations so a `claudemesh send` survives a daemon
  // crash via the on-disk outbox.
  {
    const dr = await trySendViaDaemon({ to, message, priority, expectedMesh: meshSlug ?? undefined });
    if (dr !== null) {
      if (dr.ok) {
        if (flags.json) {
          console.log(JSON.stringify({ ok: true, messageId: dr.messageId, target: to, via: "daemon", duplicate: !!dr.duplicate, status: dr.status, recipientOnline }));
        } else if (recipientOnline === false) {
          render.warn(`queued for ${recipientName ?? to.slice(0, 16) + "…"} — no connected peer matches this key on "${meshSlug}".`);
          render.hint(offlineHint);
        } else {
          const who = recipientName ? `${recipientName} (${to.slice(0, 16)}…)` : to;
          // recipientOnline === true → peer is present, delivery imminent.
          // null → daemon couldn't tell (e.g. roster query failed); keep
          // the neutral "(daemon)" transport tag rather than overclaiming.
          render.ok(`sent to ${who}${recipientOnline === true ? " (online)" : " (daemon)"}`, dr.messageId ? dim(dr.messageId.slice(0, 8)) : undefined);
        }
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

  // Cold path — open our own WS, encrypt locally, fire envelope. Use the
  // resolved meshSlug (may have been discovered above) so a name/prefix
  // that lives on a non-default mesh still targets the right one.
  await withMesh({ meshSlug: meshSlug ?? flags.mesh ?? null }, async (client) => {
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
        console.log(JSON.stringify({ ok: true, messageId: result.messageId, target: to, recipientOnline }));
      } else if (recipientOnline === false) {
        render.warn(`queued for ${recipientName ?? to} — no connected peer matches this key on "${meshSlug ?? flags.mesh ?? "default"}".`);
        render.hint(offlineHint);
      } else {
        const who = recipientName ? `${recipientName} (${to.slice(0, 16)}…)` : to;
        render.ok(`sent to ${who}${recipientOnline === true ? " (online)" : ""}`, result.messageId ? dim(result.messageId.slice(0, 8)) : undefined);
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
