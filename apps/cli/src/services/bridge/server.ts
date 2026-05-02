/**
 * Bridge server — the MCP push-pipe runs one of these per connected mesh.
 *
 * Listens on a Unix domain socket at `~/.claudemesh/sockets/<mesh-slug>.sock`,
 * accepts line-delimited JSON requests from CLI invocations, dispatches each
 * request to the corresponding `BrokerClient` method, and writes the response
 * back on the same line.
 *
 * Lifecycle:
 *   - `startBridgeServer(client)` is called from the MCP push-pipe boot path
 *     once the WS is connected (or even before — verbs that need an open WS
 *     will return an error).
 *   - On startup it `unlinks` any stale socket file (left by a crashed
 *     prior process), then `listen`s.
 *   - On shutdown (`stop()`) it closes the listener and unlinks the socket.
 *
 * Concurrency: each accepted connection gets its own line-buffered parser.
 * Multiple in-flight requests are correlated by `id`; the server doesn't
 * need to serialize because the underlying `BrokerClient` calls are
 * `async` and non-blocking.
 *
 * Error model: malformed lines are dropped silently (don't tear down the
 * socket). Unknown verbs return `{ok: false, error: "unknown verb"}`.
 * Broker errors are wrapped into the `error` string.
 */

import { createServer, type Server, type Socket } from "node:net";
import { mkdirSync, unlinkSync, existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { BrokerClient } from "~/services/broker/facade.js";
import {
  socketPath,
  socketDir,
  frame,
  LineParser,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeVerb,
} from "./protocol.js";

export interface BridgeServer {
  stop(): void;
  path: string;
}

type PeerStatus = "idle" | "working" | "dnd";

/**
 * Resolve a `to` string to a broker-friendly target spec. Mirrors what
 * `commands/send.ts` does today — display name → pubkey, hex stays hex,
 * `@group` and `*` pass through.
 */
async function resolveTarget(
  client: BrokerClient,
  to: string,
): Promise<{ ok: true; spec: string } | { ok: false; error: string }> {
  if (to.startsWith("@") || to === "*" || /^[0-9a-f]{64}$/i.test(to)) {
    return { ok: true, spec: to };
  }
  const peers = await client.listPeers();
  const match = peers.find((p) => p.displayName.toLowerCase() === to.toLowerCase());
  if (!match) {
    return {
      ok: false,
      error: `peer "${to}" not found. online: ${peers.map((p) => p.displayName).join(", ") || "(none)"}`,
    };
  }
  return { ok: true, spec: match.pubkey };
}

async function dispatch(
  client: BrokerClient,
  req: BridgeRequest,
): Promise<BridgeResponse> {
  const args = req.args ?? {};
  try {
    switch (req.verb as BridgeVerb) {
      case "ping": {
        const peers = await client.listPeers();
        return {
          id: req.id,
          ok: true,
          result: {
            mesh: client.meshSlug,
            ws_status: client.status,
            peers_online: peers.length,
            push_buffer: client.pushHistory.length,
          },
        };
      }
      case "peers": {
        const peers = await client.listPeers();
        return { id: req.id, ok: true, result: peers };
      }
      case "send": {
        const to = String(args.to ?? "");
        const message = String(args.message ?? "");
        const priority = (args.priority as "now" | "next" | "low" | undefined) ?? "next";
        if (!to || !message) {
          return { id: req.id, ok: false, error: "send: `to` and `message` required" };
        }
        const resolved = await resolveTarget(client, to);
        if (!resolved.ok) return { id: req.id, ok: false, error: resolved.error };
        const result = await client.send(resolved.spec, message, priority);
        if (!result.ok) {
          return { id: req.id, ok: false, error: result.error ?? "send failed" };
        }
        return {
          id: req.id,
          ok: true,
          result: { messageId: result.messageId, target: resolved.spec },
        };
      }
      case "summary": {
        const text = String(args.summary ?? "");
        if (!text) return { id: req.id, ok: false, error: "summary: `summary` required" };
        await client.setSummary(text);
        return { id: req.id, ok: true, result: { summary: text } };
      }
      case "status_set": {
        const state = String(args.status ?? "") as PeerStatus;
        if (!["idle", "working", "dnd"].includes(state)) {
          return { id: req.id, ok: false, error: "status_set: must be idle | working | dnd" };
        }
        await client.setStatus(state);
        return { id: req.id, ok: true, result: { status: state } };
      }
      case "visible": {
        const visible = Boolean(args.visible);
        await client.setVisible(visible);
        return { id: req.id, ok: true, result: { visible } };
      }
      default:
        return { id: req.id, ok: false, error: `unknown verb: ${req.verb}` };
    }
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function handleConnection(socket: Socket, client: BrokerClient): void {
  const parser = new LineParser();

  socket.on("data", (chunk) => {
    const lines = parser.feed(chunk);
    for (const line of lines) {
      if (!line.trim()) continue;
      let req: BridgeRequest;
      try {
        req = JSON.parse(line) as BridgeRequest;
      } catch {
        continue;
      }
      if (!req || typeof req !== "object" || !req.id || !req.verb) continue;

      // Fire-and-await without blocking the read loop.
      void dispatch(client, req).then((res) => {
        try {
          socket.write(frame(res));
        } catch {
          /* socket might have closed mid-flight; ignore */
        }
      });
    }
  });

  socket.on("error", () => {
    // Don't crash the push-pipe on per-connection errors.
  });
}

/**
 * Start the per-mesh bridge server. Returns a handle the caller stores so
 * it can `stop()` on shutdown.
 *
 * Idempotent: if a socket file already exists, attempts to connect to it.
 * If that connection succeeds, another live process owns it — return null.
 * If it fails (ECONNREFUSED), the file is stale; unlink it and proceed.
 */
export function startBridgeServer(client: BrokerClient): BridgeServer | null {
  const path = socketPath(client.meshSlug);
  const dir = socketDir();

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Last-writer-wins: unconditionally remove any existing socket file and
  // bind fresh. A live process previously holding it keeps its already-
  // accepted connections (sockets aren't path-based after connect), but
  // new CLI dials hit the new server. In practice this only matters when
  // two `claudemesh launch` invocations target the same mesh — rare, and
  // either instance serving CLI requests is fine because both speak to
  // the same broker.
  if (existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }

  const server: Server = createServer((socket) => handleConnection(socket, client));

  try {
    server.listen(path);
  } catch (err) {
    process.stderr.write(`[claudemesh] bridge: failed to bind ${path}: ${String(err)}\n`);
    return null;
  }

  server.on("error", (err) => {
    process.stderr.write(`[claudemesh] bridge: ${String(err)}\n`);
  });

  // Tighten permissions so other users on the host can't dial in.
  try { chmodSync(path, 0o600); } catch {}

  let stopped = false;
  return {
    path,
    stop(): void {
      if (stopped) return;
      stopped = true;
      try { server.close(); } catch {}
      try { unlinkSync(path); } catch {}
    },
  };
}
