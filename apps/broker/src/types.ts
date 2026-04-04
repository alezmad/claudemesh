/**
 * Broker protocol types.
 *
 * Wire format for WebSocket messages between peers and broker. Kept
 * minimal here — the concrete schema lands in step 8 when we port the
 * claude-intercom logic into this workspace.
 */

export type Priority = "now" | "next" | "low";

export type PeerStatus = "idle" | "working" | "dnd";

export type StatusSource = "hook" | "manual" | "jsonl";

/** Runtime view of a connected peer. */
export interface Peer {
  id: string; // broker-assigned short id
  meshId: string;
  pubkey: string; // ed25519 hex
  displayName: string;
  status: PeerStatus;
  statusSource: StatusSource;
  statusUpdatedAt: Date;
  connectedAt: Date;
}

/**
 * Generic WS message envelope. Concrete variants (hello, send, ack,
 * presence, channel_push) are defined in step 8.
 */
export interface WSMessage<T = unknown> {
  type: string;
  payload: T;
  id?: string;
}
