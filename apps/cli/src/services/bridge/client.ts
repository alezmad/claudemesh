/**
 * Bridge client — CLI invocations dial the per-mesh Unix socket the
 * MCP push-pipe holds open, so they reuse its warm WS instead of opening
 * a fresh one (~5ms vs ~300-700ms).
 *
 * Usage from a command:
 *
 *   const result = await tryBridge(meshSlug, "send", { to, message });
 *   if (result === null) { ...fall through to cold withMesh()... }
 *   else { ...warm path succeeded... }
 *
 * `tryBridge` returns null on:
 *   - socket file absent (no push-pipe running)
 *   - socket connect fails (push-pipe crashed without cleanup)
 *   - bridge timeout
 * That null is the caller's signal to fall back to a cold WS connection
 * via `withMesh`. So the bridge is purely an optimization — every verb
 * still works without it.
 */

import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  socketPath,
  frame,
  LineParser,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeVerb,
} from "./protocol.js";

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Send one request and await the matching response. Returns:
 *   - { ok: true, result } on success
 *   - { ok: false, error } on bridge-reachable-but-broker-error
 *   - null on bridge-unreachable (caller should fall back to cold WS)
 */
export async function tryBridge(
  meshSlug: string,
  verb: BridgeVerb,
  args: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string } | null> {
  const path = socketPath(meshSlug);
  if (!existsSync(path)) return null;

  return new Promise((resolve) => {
    const id = randomUUID();
    const req: BridgeRequest = { id, verb, args };
    const parser = new LineParser();
    let settled = false;

    const finish = (
      value: { ok: true; result: unknown } | { ok: false; error: string } | null,
    ): void => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      clearTimeout(timer);
      resolve(value);
    };

    const socket = createConnection({ path });

    const timer = setTimeout(() => {
      finish(null); // timeout = bridge unreachable, fall back to cold path
    }, timeoutMs);

    socket.on("connect", () => {
      try {
        socket.write(frame(req));
      } catch {
        finish(null);
      }
    });

    socket.on("data", (chunk) => {
      const lines = parser.feed(chunk);
      for (const line of lines) {
        if (!line.trim()) continue;
        let res: BridgeResponse;
        try {
          res = JSON.parse(line) as BridgeResponse;
        } catch {
          continue;
        }
        if (res.id !== id) continue; // not our response — keep reading
        if (res.ok) finish({ ok: true, result: res.result });
        else finish({ ok: false, error: res.error });
        return;
      }
    });

    socket.on("error", (err) => {
      // ENOENT (file disappeared between existsSync and connect),
      // ECONNREFUSED (stale socket), EPERM (permission), etc. — all mean
      // bridge unreachable.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ECONNREFUSED" || code === "ENOENT" || code === "EPERM") {
        finish(null);
      } else {
        finish(null);
      }
    });

    socket.on("close", () => {
      // If we close without a response, treat as unreachable.
      finish(null);
    });
  });
}
