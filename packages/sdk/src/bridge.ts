/**
 * Bridge — forward a single topic between two meshes.
 *
 * A bridge is a peer that holds memberships in two meshes simultaneously
 * and relays messages on a single topic from each side to the other.
 * Federation-lite: get the value of cross-mesh communication without
 * designing a broker-to-broker protocol.
 *
 * Loop prevention via plaintext hop counter: every forwarded message is
 * prefixed with `__cmh<n>:` where <n> is the hop count. The bridge
 * increments on forward; if it sees a message at or beyond `maxHops`, it
 * drops. The bridge also drops messages whose sender pubkey matches its
 * own membership on either side (echo protection).
 *
 * The hop prefix is visible to readers — a wart, but acceptable for
 * v0.2.0. A v0.3.0 follow-up will move loop tracking into broker
 * primitives (message tags / metadata fields).
 *
 * Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
 */

import { EventEmitter } from "node:events";
import { MeshClient } from "./client.js";
import type { MeshClientOptions, InboundMessage } from "./types.js";

export interface BridgeSide {
  /** MeshClient options for this side (broker URL, mesh keys, identity). */
  client: MeshClientOptions;
  /** Topic name to forward (without `#` prefix). */
  topic: string;
  /** Optional role applied when joining the topic. */
  role?: "lead" | "member" | "observer";
}

export interface BridgeOptions {
  a: BridgeSide;
  b: BridgeSide;
  /** Maximum total hops a message can take. Default 2 (one forward each way). */
  maxHops?: number;
  /** Optional filter — return false to skip forwarding a specific message. */
  filter?: (
    msg: InboundMessage,
    fromSide: "a" | "b",
  ) => boolean | Promise<boolean>;
}

export interface BridgeEvents {
  forwarded: [{ from: "a" | "b"; to: "a" | "b"; hop: number; bytes: number }];
  dropped: [{ from: "a" | "b"; reason: string; hop: number }];
  error: [Error];
}

const HOP_PREFIX_RE = /^__cmh(\d+):/;
const MAX_HOPS_DEFAULT = 2;

export class Bridge extends EventEmitter<BridgeEvents> {
  private clientA: MeshClient;
  private clientB: MeshClient;
  private maxHops: number;
  private opts: BridgeOptions;
  private started = false;

  constructor(opts: BridgeOptions) {
    super();
    this.opts = opts;
    this.maxHops = opts.maxHops ?? MAX_HOPS_DEFAULT;
    this.clientA = new MeshClient(opts.a.client);
    this.clientB = new MeshClient(opts.b.client);
  }

  /**
   * Connect both clients, subscribe to topics on both sides, wire the
   * forwarding handlers. Resolves once both meshes are open and joined.
   * Throws if either side fails to connect.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await Promise.all([this.clientA.connect(), this.clientB.connect()]);
    await Promise.all([
      this.clientA.joinTopic(this.opts.a.topic, this.opts.a.role),
      this.clientB.joinTopic(this.opts.b.topic, this.opts.b.role),
    ]);

    this.clientA.on("message", (m: InboundMessage) =>
      this.handleIncoming("a", m).catch((e: unknown) =>
        this.emit("error", e instanceof Error ? e : new Error(String(e))),
      ),
    );
    this.clientB.on("message", (m: InboundMessage) =>
      this.handleIncoming("b", m).catch((e: unknown) =>
        this.emit("error", e instanceof Error ? e : new Error(String(e))),
      ),
    );
  }

  /** Disconnect both clients. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.clientA.disconnect();
    this.clientB.disconnect();
  }

  private async handleIncoming(
    fromSide: "a" | "b",
    msg: InboundMessage,
  ): Promise<void> {
    // Only forward messages we can read plaintext for. System events,
    // DMs targeted to other peers, and crypto_box-encrypted messages we
    // can't decrypt are skipped — every bridged message has to round-trip
    // through `send(plaintext)` on the other side, so we need text.
    if (msg.subtype === "system") return;
    const text = msg.plaintext;
    if (!text) return;

    // Echo guard — if the sender pubkey matches either of our own
    // memberships, this message was just forwarded by us. Drop before
    // it bounces.
    const ownA = this.clientA.pubkey;
    const ownB = this.clientB.pubkey;
    if (msg.senderPubkey === ownA || msg.senderPubkey === ownB) {
      this.emit("dropped", { from: fromSide, reason: "echo", hop: -1 });
      return;
    }

    // User filter
    if (this.opts.filter) {
      const ok = await this.opts.filter(msg, fromSide);
      if (!ok) {
        this.emit("dropped", { from: fromSide, reason: "filter", hop: -1 });
        return;
      }
    }

    // Parse hop counter from plaintext prefix.
    const m = text.match(HOP_PREFIX_RE);
    const currentHop = m ? Number(m[1]) : 0;
    const nextHop = currentHop + 1;

    if (nextHop > this.maxHops) {
      this.emit("dropped", { from: fromSide, reason: "max_hops", hop: currentHop });
      return;
    }

    // Strip existing prefix, prepend new one.
    const stripped = m ? text.slice(m[0].length) : text;
    const forwarded = `__cmh${nextHop}:${stripped}`;

    const targetClient = fromSide === "a" ? this.clientB : this.clientA;
    const targetTopic = fromSide === "a" ? this.opts.b.topic : this.opts.a.topic;
    await targetClient.send(`#${targetTopic}`, forwarded, "next");

    this.emit("forwarded", {
      from: fromSide,
      to: fromSide === "a" ? "b" : "a",
      hop: nextHop,
      bytes: forwarded.length,
    });
  }
}
