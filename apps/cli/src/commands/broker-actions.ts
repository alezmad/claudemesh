/**
 * Small broker-side action verbs that previously lived only as MCP tools.
 *
 * These are the CLI replacements for the soft-deprecated tools
 * (set_status / set_summary / set_visible / set_profile / join_group /
 * leave_group / forget / message_status / mesh_clock / mesh_stats /
 * ping_mesh / claim_task / complete_task).
 *
 * Each verb runs against ONE mesh — pick with --mesh <slug>, or let the
 * picker prompt when multiple meshes are joined. This is the deliberate
 * difference from the MCP tools' fan-out-across-all-meshes behavior:
 * the CLI invocation model binds one connection per call.
 *
 * Spec: .artifacts/specs/2026-05-01-mcp-tool-surface-trim.md
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { tryBridge } from "~/services/bridge/client.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";
import { validateMessageId, renderValidationError } from "~/cli/validators.js";

type StateFlags = { mesh?: string; json?: boolean };
type PeerStatus = "idle" | "working" | "dnd";

/** Resolve unambiguous mesh slug for warm-path bridging. Returns null if
 * the user has multiple joined meshes and didn't pick one. */
function unambiguousMesh(opts: StateFlags): string | null {
  if (opts.mesh) return opts.mesh;
  const config = readConfig();
  return config.meshes.length === 1 ? config.meshes[0]!.slug : null;
}

// --- status ---

export async function runStatusSet(state: string, opts: StateFlags): Promise<number> {
  const valid: PeerStatus[] = ["idle", "working", "dnd"];
  if (!valid.includes(state as PeerStatus)) {
    render.err(`Invalid status: ${state}`, `must be one of: ${valid.join(", ")}`);
    return EXIT.INVALID_ARGS;
  }

  // Warm path
  const meshSlug = unambiguousMesh(opts);
  if (meshSlug) {
    const bridged = await tryBridge(meshSlug, "status_set", { status: state });
    if (bridged !== null) {
      if (bridged.ok) {
        if (opts.json) console.log(JSON.stringify({ status: state }));
        else render.ok(`status set to ${bold(state)}`);
        return EXIT.SUCCESS;
      }
      render.err(bridged.error);
      return EXIT.INTERNAL_ERROR;
    }
  }

  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.setStatus(state as PeerStatus);
  });
  if (opts.json) console.log(JSON.stringify({ status: state }));
  else render.ok(`status set to ${bold(state)}`);
  return EXIT.SUCCESS;
}

// --- summary ---

export async function runSummary(text: string, opts: StateFlags): Promise<number> {
  if (!text) {
    render.err("Usage: claudemesh summary <text>");
    return EXIT.INVALID_ARGS;
  }

  // Warm path
  const meshSlug = unambiguousMesh(opts);
  if (meshSlug) {
    const bridged = await tryBridge(meshSlug, "summary", { summary: text });
    if (bridged !== null) {
      if (bridged.ok) {
        if (opts.json) console.log(JSON.stringify({ summary: text }));
        else render.ok("summary set", dim(text));
        return EXIT.SUCCESS;
      }
      render.err(bridged.error);
      return EXIT.INTERNAL_ERROR;
    }
  }

  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.setSummary(text);
  });
  if (opts.json) console.log(JSON.stringify({ summary: text }));
  else render.ok("summary set", dim(text));
  return EXIT.SUCCESS;
}

// --- visible ---

export async function runVisible(value: string | undefined, opts: StateFlags): Promise<number> {
  let visible: boolean;
  if (value === "true" || value === "1" || value === "yes") visible = true;
  else if (value === "false" || value === "0" || value === "no") visible = false;
  else {
    render.err("Usage: claudemesh visible <true|false>");
    return EXIT.INVALID_ARGS;
  }

  // Warm path
  const meshSlug = unambiguousMesh(opts);
  if (meshSlug) {
    const bridged = await tryBridge(meshSlug, "visible", { visible });
    if (bridged !== null) {
      if (bridged.ok) {
        if (opts.json) console.log(JSON.stringify({ visible }));
        else render.ok(visible ? "you are now visible to peers" : "you are now hidden", visible ? undefined : "direct messages still reach you");
        return EXIT.SUCCESS;
      }
      render.err(bridged.error);
      return EXIT.INTERNAL_ERROR;
    }
  }

  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.setVisible(visible);
  });
  if (opts.json) console.log(JSON.stringify({ visible }));
  else render.ok(visible ? "you are now visible to peers" : "you are now hidden", visible ? undefined : "direct messages still reach you");
  return EXIT.SUCCESS;
}

// --- group ---

export async function runGroupJoin(name: string | undefined, opts: StateFlags & { role?: string }): Promise<number> {
  if (!name) {
    render.err("Usage: claudemesh group join @<name> [--role X]");
    return EXIT.INVALID_ARGS;
  }
  const cleanName = name.startsWith("@") ? name.slice(1) : name;
  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.joinGroup(cleanName, opts.role);
  });
  if (opts.json) {
    console.log(JSON.stringify({ group: cleanName, role: opts.role ?? null }));
    return EXIT.SUCCESS;
  }
  render.ok(`joined ${clay("@" + cleanName)}`, opts.role ? `as ${opts.role}` : undefined);
  return EXIT.SUCCESS;
}

export async function runGroupLeave(name: string | undefined, opts: StateFlags): Promise<number> {
  if (!name) {
    render.err("Usage: claudemesh group leave @<name>");
    return EXIT.INVALID_ARGS;
  }
  const cleanName = name.startsWith("@") ? name.slice(1) : name;
  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.leaveGroup(cleanName);
  });
  if (opts.json) {
    console.log(JSON.stringify({ group: cleanName, left: true }));
    return EXIT.SUCCESS;
  }
  render.ok(`left ${clay("@" + cleanName)}`);
  return EXIT.SUCCESS;
}

// --- forget ---

export async function runForget(id: string | undefined, opts: StateFlags): Promise<number> {
  if (!id) {
    render.err("Usage: claudemesh forget <memory-id>");
    return EXIT.INVALID_ARGS;
  }
  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.forget(id);
  });
  if (opts.json) {
    console.log(JSON.stringify({ id, forgotten: true }));
    return EXIT.SUCCESS;
  }
  render.ok(`forgot ${dim(id.slice(0, 8))}`);
  return EXIT.SUCCESS;
}

// --- msg-status ---

export async function runMsgStatus(id: string | undefined, opts: StateFlags): Promise<number> {
  // Validate input shape *before* we open a WS connection, so a typo
  // returns a structured error instead of "not found or timed out".
  const v = validateMessageId(id);
  if (!v.ok) {
    if (opts.json) {
      console.log(
        JSON.stringify({
          ok: false,
          error: "invalid_argument",
          field: "messageId",
          code: v.code,
          reason: v.reason,
          expected: v.expected,
        }),
      );
    } else {
      renderValidationError({
        verb: "msg-status",
        input: id ?? "(missing)",
        result: v,
      });
    }
    return EXIT.INVALID_ARGS;
  }
  const lookupId = v.value.value;
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const result = await client.messageStatus(lookupId);
    if (!result) {
      if (opts.json) {
        console.log(
          JSON.stringify({
            ok: false,
            error: "not_found",
            id: lookupId,
            isPrefix: v.value.isPrefix,
          }),
        );
      } else {
        const hint = v.value.isPrefix
          ? `   no message id starts with ${dim("\"" + lookupId + "\"")} in this mesh.\n   try: claudemesh msg-status <full-32-char-id>`
          : `   message ${dim(lookupId.slice(0, 12) + "…")} not in queue (already drained, expired, or never sent in this mesh).`;
        render.err(`message not found`);
        process.stderr.write(hint + "\n");
      }
      return EXIT.NOT_FOUND;
    }
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return EXIT.SUCCESS;
    }
    render.section(`message ${id.slice(0, 12)}…`);
    render.kv([
      ["target", result.targetSpec],
      ["delivered", result.delivered ? "yes" : "no"],
      ["delivered_at", result.deliveredAt ?? dim("—")],
    ]);
    if (result.recipients.length > 0) {
      render.blank();
      render.heading("recipients");
      for (const r of result.recipients) {
        process.stdout.write(`  ${bold(r.name)} ${dim(r.pubkey.slice(0, 12) + "…")} ${dim("·")} ${r.status}\n`);
      }
    }
    return EXIT.SUCCESS;
  });
}

// --- clock ---

export async function runClock(opts: StateFlags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const result = await client.getClock();
    if (!result) {
      if (opts.json) console.log(JSON.stringify({ error: "timed out" }));
      else render.err("Clock query timed out");
      return EXIT.INTERNAL_ERROR;
    }
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return EXIT.SUCCESS;
    }
    const statusLabel = result.speed === 0 ? "not started" : result.paused ? "paused" : "running";
    render.section(`mesh clock — ${statusLabel}`);
    render.kv([
      ["speed", `x${result.speed}`],
      ["tick", String(result.tick)],
      ["sim_time", result.simTime],
      ["started_at", result.startedAt],
    ]);
    return EXIT.SUCCESS;
  });
}

// --- stats ---

export async function runStats(opts: StateFlags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const peers = await client.listPeers();
    if (opts.json) {
      console.log(JSON.stringify({
        mesh: client.meshSlug,
        peers: peers.map((p) => ({ name: p.displayName, pubkey: p.pubkey, stats: p.stats ?? null })),
      }, null, 2));
      return EXIT.SUCCESS;
    }
    render.section(client.meshSlug);
    for (const p of peers) {
      const s = p.stats;
      if (!s) {
        process.stdout.write(`  ${bold(p.displayName)} ${dim("(no stats)")}\n`);
        continue;
      }
      const up = s.uptime != null ? `${Math.floor(s.uptime / 60)}m` : "—";
      process.stdout.write(
        `  ${bold(p.displayName)}  ${dim(`in:${s.messagesIn ?? 0}  out:${s.messagesOut ?? 0}  tools:${s.toolCalls ?? 0}  up:${up}  err:${s.errors ?? 0}`)}\n`,
      );
    }
    return EXIT.SUCCESS;
  });
}

// --- ping ---

export async function runPing(opts: StateFlags): Promise<number> {
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const peers = await client.listPeers();
    if (opts.json) {
      console.log(JSON.stringify({
        mesh: client.meshSlug,
        ws_status: client.status,
        peers_online: peers.length,
        push_buffer: client.pushHistory.length,
      }, null, 2));
      return EXIT.SUCCESS;
    }
    render.section(`ping ${client.meshSlug}`);
    render.kv([
      ["ws_status", client.status],
      ["peers_online", String(peers.length)],
      ["push_buffer", String(client.pushHistory.length)],
    ]);
    return EXIT.SUCCESS;
  });
}

// --- task ---

export async function runTaskClaim(id: string | undefined, opts: StateFlags): Promise<number> {
  if (!id) {
    render.err("Usage: claudemesh task claim <id>");
    return EXIT.INVALID_ARGS;
  }
  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.claimTask(id);
  });
  if (opts.json) {
    console.log(JSON.stringify({ id, claimed: true }));
    return EXIT.SUCCESS;
  }
  render.ok(`claimed ${dim(id.slice(0, 8))}`);
  return EXIT.SUCCESS;
}

export async function runTaskComplete(id: string | undefined, result: string | undefined, opts: StateFlags): Promise<number> {
  if (!id) {
    render.err("Usage: claudemesh task complete <id> [result]");
    return EXIT.INVALID_ARGS;
  }
  await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    await client.completeTask(id, result);
  });
  if (opts.json) {
    console.log(JSON.stringify({ id, completed: true, result: result ?? null }));
    return EXIT.SUCCESS;
  }
  render.ok(`completed ${dim(id.slice(0, 8))}`, result);
  return EXIT.SUCCESS;
}
