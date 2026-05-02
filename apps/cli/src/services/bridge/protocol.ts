/**
 * Bridge protocol — wire format between the MCP push-pipe (server) and
 * CLI invocations (client) over a per-mesh Unix domain socket.
 *
 * Why: every CLI op should reuse the warm WS the push-pipe already holds
 * (~5ms) instead of opening its own (~300-700ms cold start). The bridge is
 * the load-bearing piece of the CLI-first architecture — see
 * .artifacts/specs/2026-05-02-architecture-north-star.md commitment #3.
 *
 * Wire format: line-delimited JSON. One JSON object per "\n"-terminated line.
 * Each request carries an `id` string; the response echoes it.
 *
 * Socket path: ~/.claudemesh/sockets/<mesh-slug>.sock (mode 0600).
 *
 * Connection model: persistent. A CLI invocation opens, sends one or more
 * requests, reads matching responses, then closes. Multiplexing via `id`
 * means concurrent CLI calls don't have to serialize on the same socket
 * (though current callers all do one round-trip and exit).
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const PROTOCOL_VERSION = 1;

/** Socket path for a given mesh. Caller is responsible for ensuring the
 * parent directory exists (`~/.claudemesh/sockets/`). */
export function socketPath(meshSlug: string): string {
  return join(homedir(), ".claudemesh", "sockets", `${meshSlug}.sock`);
}

/** Directory holding all per-mesh sockets. Created with mode 0700 on push-pipe boot. */
export function socketDir(): string {
  return join(homedir(), ".claudemesh", "sockets");
}

/**
 * Verbs the bridge accepts. Keep this list narrow in 1.2.0 — three writes
 * (send, summary, status), the read-shaped peers, plus ping for health.
 * Expand in 1.3.0 once the bridge is proven.
 */
export type BridgeVerb =
  | "ping"
  | "peers"
  | "send"
  | "summary"
  | "status_set"
  | "visible";

export interface BridgeRequest {
  id: string;
  verb: BridgeVerb;
  args?: Record<string, unknown>;
}

export interface BridgeResponseOk {
  id: string;
  ok: true;
  result: unknown;
}

export interface BridgeResponseErr {
  id: string;
  ok: false;
  error: string;
}

export type BridgeResponse = BridgeResponseOk | BridgeResponseErr;

/** Serialise a request/response to a single line ("\n"-terminated). */
export function frame(obj: BridgeRequest | BridgeResponse): string {
  return JSON.stringify(obj) + "\n";
}

/**
 * Stateful line-buffered parser. Pass each chunk from the socket via
 * `feed`; collect completed lines from the returned array.
 */
export class LineParser {
  private buf = "";

  feed(chunk: Buffer | string): string[] {
    this.buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    const lines: string[] = [];
    let nl = this.buf.indexOf("\n");
    while (nl !== -1) {
      lines.push(this.buf.slice(0, nl));
      this.buf = this.buf.slice(nl + 1);
      nl = this.buf.indexOf("\n");
    }
    return lines;
  }
}
