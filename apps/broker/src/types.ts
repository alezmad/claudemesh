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
  sessionPubkey?: string; // ephemeral per-launch pubkey for message routing
  displayName?: string; // optional override for this session
  sessionId: string;
  pid: number;
  cwd: string;
  /** Initial groups to join on connect. */
  groups?: Array<{ name: string; role?: string }>;
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

/** Client → broker: join a group with optional role. */
export interface WSJoinGroupMessage {
  type: "join_group";
  name: string;
  role?: string;
}

/** Client → broker: leave a group. */
export interface WSLeaveGroupMessage {
  type: "leave_group";
  name: string;
}

/** Client → broker: set a shared state key-value. */
export interface WSSetStateMessage {
  type: "set_state";
  key: string;
  value: unknown;
}

/** Client → broker: read a shared state key. */
export interface WSGetStateMessage {
  type: "get_state";
  key: string;
}

/** Client → broker: list all shared state entries. */
export interface WSListStateMessage {
  type: "list_state";
}

/** Client → broker: store a memory. */
export interface WSRememberMessage {
  type: "remember";
  content: string;
  tags?: string[];
}

/** Client → broker: full-text search memories. */
export interface WSRecallMessage {
  type: "recall";
  query: string;
}

/** Client → broker: soft-delete a memory. */
export interface WSForgetMessage {
  type: "forget";
  memoryId: string;
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
    groups: Array<{ name: string; role?: string }>;
    sessionId: string;
    connectedAt: string;
  }>;
}

/** Broker → client: a state key was changed by another peer. */
export interface WSStateChangeMessage {
  type: "state_change";
  key: string;
  value: unknown;
  updatedBy: string;
}

/** Broker → client: response to get_state. */
export interface WSStateResultMessage {
  type: "state_result";
  key: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string;
}

/** Broker → client: response to list_state. */
export interface WSStateListMessage {
  type: "state_list";
  entries: Array<{
    key: string;
    value: unknown;
    updatedBy: string;
    updatedAt: string;
  }>;
}

/** Broker → client: acknowledgement for a remember. */
export interface WSMemoryStoredMessage {
  type: "memory_stored";
  id: string;
}

/** Broker → client: response to recall. */
export interface WSMemoryResultsMessage {
  type: "memory_results";
  memories: Array<{
    id: string;
    content: string;
    tags: string[];
    rememberedBy: string;
    rememberedAt: string;
  }>;
}

/** Client → broker: check delivery status of a message. */
export interface WSMessageStatusMessage {
  type: "message_status";
  messageId: string;
}

/** Broker → client: delivery status with per-recipient detail. */
export interface WSMessageStatusResultMessage {
  type: "message_status_result";
  messageId: string;
  targetSpec: string;
  delivered: boolean;
  deliveredAt: string | null;
  recipients: Array<{
    name: string;
    pubkey: string;
    status: "delivered" | "held" | "disconnected";
  }>;
}

// --- File sharing messages ---

/** Client → broker: get a presigned download URL for a file. */
export interface WSGetFileMessage {
  type: "get_file";
  fileId: string;
}

/** Client → broker: list files in the mesh. */
export interface WSListFilesMessage {
  type: "list_files";
  query?: string;
  from?: string;
}

/** Client → broker: get access log for a file. */
export interface WSFileStatusMessage {
  type: "file_status";
  fileId: string;
}

/** Client → broker: soft-delete a file. */
export interface WSDeleteFileMessage {
  type: "delete_file";
  fileId: string;
}

/** Broker → client: presigned URL for downloading a file. */
export interface WSFileUrlMessage {
  type: "file_url";
  fileId: string;
  url: string;
  name: string;
}

/** Broker → client: list of files in the mesh. */
export interface WSFileListMessage {
  type: "file_list";
  files: Array<{
    id: string;
    name: string;
    size: number;
    tags: string[];
    uploadedBy: string;
    uploadedAt: string;
    persistent: boolean;
  }>;
}

/** Broker → client: access log for a file. */
export interface WSFileStatusResultMessage {
  type: "file_status_result";
  fileId: string;
  accesses: Array<{
    peerName: string;
    accessedAt: string;
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
  | WSSetSummaryMessage
  | WSJoinGroupMessage
  | WSLeaveGroupMessage
  | WSSetStateMessage
  | WSGetStateMessage
  | WSListStateMessage
  | WSRememberMessage
  | WSRecallMessage
  | WSForgetMessage
  | WSMessageStatusMessage
  | WSGetFileMessage
  | WSListFilesMessage
  | WSFileStatusMessage
  | WSDeleteFileMessage;

export type WSServerMessage =
  | WSHelloAckMessage
  | WSPushMessage
  | WSAckMessage
  | WSPeersListMessage
  | WSStateChangeMessage
  | WSStateResultMessage
  | WSStateListMessage
  | WSMemoryStoredMessage
  | WSMemoryResultsMessage
  | WSMessageStatusResultMessage
  | WSFileUrlMessage
  | WSFileListMessage
  | WSFileStatusResultMessage
  | WSErrorMessage;
