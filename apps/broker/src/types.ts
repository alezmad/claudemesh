/**
 * Broker types.
 *
 * Wire format for WebSocket messages between peers and broker, plus the
 * internal status/priority enums that govern delivery. The status model
 * is ported verbatim from claude-intercom and reflects the proven
 * hook > manual > jsonl priority design.
 */

export type Priority = "now" | "next" | "low";

export type PeerStatus = "idle" | "working" | "dnd";

export type StatusSource = "hook" | "manual" | "jsonl";

/** Runtime view of a connected peer (derived from mesh.presence + mesh.member). */
export interface ConnectedPeer {
  presenceId: string;
  memberId: string;
  meshId: string;
  pubkey: string; // ed25519 hex, from mesh.member
  displayName: string;
  sessionId: string;
  pid: number;
  cwd: string;
  status: PeerStatus;
  statusSource: StatusSource;
  statusUpdatedAt: Date;
  connectedAt: Date;
}

/** Hook-driven status update (received via HTTP POST /hook/set-status). */
export interface HookSetStatusRequest {
  cwd: string;
  pid?: number;
  status: PeerStatus;
  session_id?: string;
}

export interface HookSetStatusResponse {
  ok: boolean;
  presence_id?: string;
  pending?: boolean;
  error?: string;
}

// --- WebSocket protocol envelopes ---

/** Sent by client on connect to authenticate. */
export interface WSHelloMessage {
  type: "hello";
  meshId: string;
  memberId: string;
  pubkey: string; // must match mesh.member.peerPubkey
  displayName?: string; // optional override for this session
  sessionId: string;
  pid: number;
  cwd: string;
  /** ms epoch; broker rejects if outside ±60s of its own clock. */
  timestamp: number;
  /** ed25519 signature (hex) over the canonical hello bytes:
   *    `${meshId}|${memberId}|${pubkey}|${timestamp}` */
  signature: string;
}

/** Client → broker: send an E2E-encrypted envelope to a target. */
export interface WSSendMessage {
  type: "send";
  targetSpec: string; // member pubkey | "#channel" | "tag:xyz" | "*"
  priority: Priority;
  nonce: string; // base64
  ciphertext: string; // base64
  id?: string; // client-side correlation id
}

/** Broker → client: an envelope addressed to this peer. */
export interface WSPushMessage {
  type: "push";
  messageId: string;
  meshId: string;
  senderPubkey: string;
  priority: Priority;
  nonce: string;
  ciphertext: string;
  createdAt: string;
}

/** Client → broker: manual status override (dnd, forced idle). */
export interface WSSetStatusMessage {
  type: "set_status";
  status: PeerStatus;
}

/** Client → broker: request list of connected peers in the same mesh. */
export interface WSListPeersMessage {
  type: "list_peers";
}

/** Client → broker: update the session's human-readable summary. */
export interface WSSetSummaryMessage {
  type: "set_summary";
  summary: string;
}

/** Broker → client: acknowledgement for a send. */
export interface WSAckMessage {
  type: "ack";
  id: string; // echoes client-side correlation id
  messageId: string;
  queued: boolean;
}

/** Broker → client: hello handshake acknowledgement. */
export interface WSHelloAckMessage {
  type: "hello_ack";
  presenceId: string;
  memberDisplayName: string;
}

/** Broker → client: list of connected peers in the same mesh. */
export interface WSPeersListMessage {
  type: "peers_list";
  peers: Array<{
    pubkey: string;
    displayName: string;
    status: PeerStatus;
    summary: string | null;
    sessionId: string;
    connectedAt: string;
  }>;
}

/** Broker → client: structured error. */
export interface WSErrorMessage {
  type: "error";
  code: string;
  message: string;
  id?: string;
}

export type WSClientMessage =
  | WSHelloMessage
  | WSSendMessage
  | WSSetStatusMessage
  | WSListPeersMessage
  | WSSetSummaryMessage;

export type WSServerMessage =
  | WSHelloAckMessage
  | WSPushMessage
  | WSAckMessage
  | WSPeersListMessage
  | WSErrorMessage;
