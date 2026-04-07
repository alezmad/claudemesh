/** Priority levels for message delivery. */
export type Priority = "now" | "next" | "low";

/** Connection status of the client. */
export type ConnStatus = "connecting" | "open" | "closed" | "reconnecting";

/** Information about a connected peer. */
export interface PeerInfo {
  pubkey: string;
  displayName: string;
  status: string;
  summary: string | null;
  groups: Array<{ name: string; role?: string }>;
  sessionId: string;
  connectedAt: string;
  cwd?: string;
  peerType?: "ai" | "human" | "connector";
  channel?: string;
  model?: string;
}

/** An inbound message received from the broker. */
export interface InboundMessage {
  messageId: string;
  meshId: string;
  senderPubkey: string;
  priority: Priority;
  nonce: string;
  ciphertext: string;
  createdAt: string;
  receivedAt: string;
  /** Decrypted plaintext. null if decryption failed or broadcast. */
  plaintext: string | null;
  /** Message kind: "direct" (crypto_box), "broadcast", "channel", or "unknown". */
  kind: "direct" | "broadcast" | "channel" | "unknown";
  /** Optional semantic tag. */
  subtype?: "reminder" | "system";
  /** Machine-readable event name (e.g. "peer_joined", "peer_left"). */
  event?: string;
  /** Structured payload for the event. */
  eventData?: Record<string, unknown>;
}

/** Options for constructing a MeshClient. */
export interface MeshClientOptions {
  /** WebSocket URL of the broker (e.g. "wss://ic.claudemesh.com/ws"). */
  brokerUrl: string;
  /** Mesh ID to join. */
  meshId: string;
  /** Member ID within the mesh. */
  memberId: string;
  /** Ed25519 public key (hex). Used for signing the hello handshake. */
  pubkey: string;
  /** Ed25519 secret key (hex). Used for signing and encryption. */
  secretKey: string;
  /** Display name visible to other peers. */
  displayName?: string;
  /** Peer type: "ai", "human", or "connector". Defaults to "connector". */
  peerType?: "ai" | "human" | "connector";
  /** Channel identifier (e.g. "claude-code", "custom"). */
  channel?: string;
  /** Enable debug logging to stderr. */
  debug?: boolean;
}
