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

/**
 * Wire protocol version. Bump ONLY on breaking changes to the hello or
 * push envelope shape. Clients send their highest supported version;
 * broker picks the minimum of its own and the client's and echoes it
 * on hello_ack. Backward-compat fields can be gated on this.
 *   1 = initial release
 */
export const WS_PROTOCOL_VERSION = 1 as const;

/** Sent by client on connect to authenticate. */
export interface WSHelloMessage {
  type: "hello";
  /** Highest WS protocol version the client understands. Optional —
   * pre-alpha.36 clients omit it and the broker treats missing as 1. */
  protocolVersion?: number;
  /** Optional feature strings the client supports. Broker uses this to
   * avoid emitting envelopes the client can't parse. Examples: "grants",
   * "channels", "streams". Unknown capabilities ignored. */
  capabilities?: string[];
  meshId: string;
  memberId: string;
  pubkey: string; // must match mesh.member.peerPubkey
  sessionPubkey?: string; // ephemeral per-launch pubkey for message routing
  displayName?: string; // optional override for this session
  sessionId: string;
  pid: number;
  cwd: string;
  /** OS hostname — used to detect same-machine peers for direct file access. */
  hostname?: string;
  /** Peer type: ai session, human user, or external connector. */
  peerType?: "ai" | "human" | "connector";
  /** Channel the peer connected from (e.g. "claude-code", "telegram", "slack", "web"). */
  channel?: string;
  /** AI model identifier (e.g. "opus-4", "sonnet-4"). */
  model?: string;
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
  /** Optional semantic tag — "reminder" when delivered by the scheduler,
   *  "system" for broker-originated topology events (peer join/leave). */
  subtype?: "reminder" | "system";
  /** Machine-readable event name (e.g. "peer_joined", "peer_left"). */
  event?: string;
  /** Structured payload for the event. */
  eventData?: Record<string, unknown>;
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


/** Client → broker: toggle visibility in the mesh. */
export interface WSSetVisibleMessage {
  type: "set_visible";
  visible: boolean;
  _reqId?: string;
}

/** Client → broker: set public profile metadata. */
export interface WSSetProfileMessage {
  type: "set_profile";
  avatar?: string; // emoji or URL
  title?: string; // short role label
  bio?: string; // one-liner
  capabilities?: string[]; // what I can help with
  _reqId?: string;
}
/** Client → broker: self-report resource usage stats. */
export interface WSSetStatsMessage {
  type: "set_stats";
  stats: {
    messagesIn?: number;
    messagesOut?: number;
    toolCalls?: number;
    uptime?: number; // seconds since session start
    errors?: number;
  };
  _reqId?: string;
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

// ── API keys (v0.2.0) ───────────────────────────────────────────────
// Issuance/management of bearer tokens for REST + external WS. Only the
// mesh admin can issue; keys are scoped by capability + optional topic
// whitelist. Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md

export interface WSApiKeyCreateMessage {
  type: "apikey_create";
  label: string;
  capabilities: Array<"send" | "read" | "state_write" | "admin">;
  topicScopes?: string[];
  expiresAt?: string;
  _reqId?: string;
}

export interface WSApiKeyListMessage {
  type: "apikey_list";
  _reqId?: string;
}

export interface WSApiKeyRevokeMessage {
  type: "apikey_revoke";
  id: string;
  _reqId?: string;
}

export interface WSApiKeyCreatedMessage {
  type: "apikey_created";
  id: string;
  /** Plaintext secret — shown ONCE, never returned again. */
  secret: string;
  label: string;
  prefix: string;
  capabilities: Array<"send" | "read" | "state_write" | "admin">;
  topicScopes: string[] | null;
  createdAt: string;
  _reqId?: string;
}

export interface WSApiKeyListResponseMessage {
  type: "apikey_list_response";
  keys: Array<{
    id: string;
    label: string;
    prefix: string;
    capabilities: Array<"send" | "read" | "state_write" | "admin">;
    topicScopes: string[] | null;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    expiresAt: string | null;
  }>;
  _reqId?: string;
}

export interface WSApiKeyRevokeResponseMessage {
  type: "apikey_revoke_response";
  status: "revoked" | "not_found" | "not_unique";
  /** Full id of the revoked key on success (may differ from input if a prefix was sent). */
  id?: string;
  /** How many keys matched on not_unique. */
  matches?: number;
  _reqId?: string;
}

// ── Topics (v0.2.0) ─────────────────────────────────────────────────
// Topics complement groups: groups are identity tags, topics are
// conversation scopes. targetSpec for topic-tagged messages is
// "#<topicId>". Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md

export interface WSTopicCreateMessage {
  type: "topic_create";
  name: string;
  description?: string;
  visibility?: "public" | "private" | "dm";
  _reqId?: string;
}

export interface WSTopicListMessage {
  type: "topic_list";
  _reqId?: string;
}

export interface WSTopicJoinMessage {
  type: "topic_join";
  /** Topic id OR name. Server resolves. */
  topic: string;
  role?: "lead" | "member" | "observer";
  _reqId?: string;
}

export interface WSTopicLeaveMessage {
  type: "topic_leave";
  topic: string;
  _reqId?: string;
}

export interface WSTopicMembersMessage {
  type: "topic_members";
  topic: string;
  _reqId?: string;
}

export interface WSTopicHistoryMessage {
  type: "topic_history";
  topic: string;
  limit?: number;
  beforeId?: string;
  _reqId?: string;
}

export interface WSTopicMarkReadMessage {
  type: "topic_mark_read";
  topic: string;
  _reqId?: string;
}

// Server → client topic responses

export interface WSTopicCreatedMessage {
  type: "topic_created";
  topic: { id: string; name: string; visibility: "public" | "private" | "dm" };
  created: boolean;
  _reqId?: string;
}

export interface WSTopicListResponseMessage {
  type: "topic_list_response";
  topics: Array<{
    id: string;
    name: string;
    description: string | null;
    visibility: "public" | "private" | "dm";
    memberCount: number;
    createdAt: string;
  }>;
  _reqId?: string;
}

export interface WSTopicMembersResponseMessage {
  type: "topic_members_response";
  topic: string;
  members: Array<{
    memberId: string;
    pubkey: string;
    displayName: string;
    role: "lead" | "member" | "observer";
    joinedAt: string;
    lastReadAt: string | null;
  }>;
  _reqId?: string;
}

export interface WSTopicHistoryResponseMessage {
  type: "topic_history_response";
  topic: string;
  messages: Array<{
    id: string;
    senderPubkey: string;
    nonce: string;
    ciphertext: string;
    createdAt: string;
  }>;
  _reqId?: string;
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
  /** Populated when queued=false to explain why (rate_limit, too_large, etc.). */
  error?: string;
  _reqId?: string;
}

/** Broker → client: hello handshake acknowledgement. */
export interface WSHelloAckMessage {
  type: "hello_ack";
  presenceId: string;
  memberDisplayName: string;
  /** True when the broker restored persisted state from a previous session. */
  restored?: boolean;
  /** Last summary set before disconnect (only when restored). */
  lastSummary?: string;
  /** ISO timestamp of last disconnect (only when restored). */
  lastSeenAt?: string;
  /** Restored groups from previous session (only when restored and hello had no groups). */
  restoredGroups?: Array<{ name: string; role?: string }>;
  /** Restored cumulative stats (only when restored). */
  restoredStats?: { messagesIn: number; messagesOut: number; toolCalls: number; errors: number };
  services?: Array<{ name: string; description: string; status: string; tools: Array<{ name: string; description: string; inputSchema: object }>; deployed_by: string }>;
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
    cwd?: string;
    hostname?: string;
    peerType?: "ai" | "human" | "connector";
    channel?: string;
    model?: string;
    stats?: {
      messagesIn?: number;
      messagesOut?: number;
      toolCalls?: number;
      uptime?: number;
      errors?: number;
    };
    visible?: boolean;
    profile?: {
      avatar?: string;
      title?: string;
      bio?: string;
      capabilities?: string[];
    };
  }>;
  _reqId?: string;
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
  _reqId?: string;
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
  _reqId?: string;
}

/** Broker → client: acknowledgement for a remember. */
export interface WSMemoryStoredMessage {
  type: "memory_stored";
  id: string;
  _reqId?: string;
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
  _reqId?: string;
}

// --- Vector storage messages ---

/** Client → broker: store a text document in a vector collection. */
export interface WSVectorStoreMessage {
  type: "vector_store";
  collection: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/** Client → broker: search a vector collection. */
export interface WSVectorSearchMessage {
  type: "vector_search";
  collection: string;
  query: string;
  limit?: number;
}

/** Client → broker: delete a point from a vector collection. */
export interface WSVectorDeleteMessage {
  type: "vector_delete";
  collection: string;
  id: string;
}

/** Client → broker: list all vector collections for this mesh. */
export interface WSListCollectionsMessage {
  type: "list_collections";
}

// --- Graph database messages ---

/** Client → broker: run a read-only Cypher query. */
export interface WSGraphQueryMessage {
  type: "graph_query";
  cypher: string;
}

/** Client → broker: run a write Cypher statement. */
export interface WSGraphExecuteMessage {
  type: "graph_execute";
  cypher: string;
}

// --- Mesh database (per-mesh PostgreSQL schema) messages ---

/** Client → broker: run a SELECT query in the mesh's schema. */
export interface WSMeshQueryMessage {
  type: "mesh_query";
  sql: string;
}

/** Client → broker: run a DDL/DML statement in the mesh's schema. */
export interface WSMeshExecuteMessage {
  type: "mesh_execute";
  sql: string;
}

/** Client → broker: list tables and columns in the mesh's schema. */
export interface WSMeshSchemaMessage {
  type: "mesh_schema";
}

// --- Vector/Graph response messages ---

/** Broker → client: confirmation that a vector point was stored. */
export interface WSVectorStoredMessage {
  type: "vector_stored";
  id: string;
  _reqId?: string;
}

/** Broker → client: vector search results. */
export interface WSVectorResultsMessage {
  type: "vector_results";
  results: Array<{
    id: string;
    text: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  _reqId?: string;
}

/** Broker → client: list of vector collections. */
export interface WSCollectionListMessage {
  type: "collection_list";
  collections: string[];
  _reqId?: string;
}

/** Broker → client: graph query results. */
export interface WSGraphResultMessage {
  type: "graph_result";
  records: Array<Record<string, unknown>>;
  _reqId?: string;
}

/** Broker → client: mesh SQL query results. */
export interface WSMeshQueryResultMessage {
  type: "mesh_query_result";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  _reqId?: string;
}

/** Broker → client: mesh schema introspection results. */
export interface WSMeshSchemaResultMessage {
  type: "mesh_schema_result";
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
  }>;
  _reqId?: string;
}

/** Client → broker: get full mesh overview. */
export interface WSMeshInfoMessage {
  type: "mesh_info";
}

/** Broker → client: aggregated mesh overview. */
export interface WSMeshInfoResultMessage {
  type: "mesh_info_result";
  mesh: string;
  peers: number;
  groups: string[];
  stateKeys: string[];
  memoryCount: number;
  fileCount: number;
  tasks: { open: number; claimed: number; done: number };
  streams: string[];
  tables: string[];
  collections: string[];
  yourName: string;
  yourGroups: Array<{ name: string; role?: string }>;
  _reqId?: string;
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
  _reqId?: string;
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

/** Client → broker: grant a peer access to an encrypted file. */
export interface WSGrantFileAccessMessage {
  type: "grant_file_access";
  fileId: string;
  peerPubkey: string;
  sealedKey: string;
}

/** Broker → client: presigned URL for downloading a file. */
export interface WSFileUrlMessage {
  type: "file_url";
  fileId: string;
  url: string;
  name: string;
  encrypted?: boolean;
  sealedKey?: string;
  _reqId?: string;
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
    encrypted: boolean;
  }>;
  _reqId?: string;
}

/** Broker → client: acknowledgement for grant_file_access. */
export interface WSGrantFileAccessOkMessage {
  type: "grant_file_access_ok";
  fileId: string;
  peerPubkey: string;
  _reqId?: string;
}

/** Broker → client: access log for a file. */
export interface WSFileStatusResultMessage {
  type: "file_status_result";
  fileId: string;
  accesses: Array<{
    peerName: string;
    accessedAt: string;
  }>;
  _reqId?: string;
}

// --- Context sharing messages ---

/** Client → broker: share current working context. */
export interface WSShareContextMessage {
  type: "share_context";
  summary: string;
  filesRead?: string[];
  keyFindings?: string[];
  tags?: string[];
}

/** Client → broker: search contexts by query. */
export interface WSGetContextMessage {
  type: "get_context";
  query: string;
}

/** Client → broker: list all contexts in the mesh. */
export interface WSListContextsMessage {
  type: "list_contexts";
}

/** Broker → client: acknowledgement for share_context. */
export interface WSContextSharedMessage {
  type: "context_shared";
  id: string;
}

/** Broker → client: response to get_context. */
export interface WSContextResultsMessage {
  type: "context_results";
  contexts: Array<{
    peerName: string;
    summary: string;
    filesRead: string[];
    keyFindings: string[];
    tags: string[];
    updatedAt: string;
  }>;
  _reqId?: string;
}

/** Broker → client: response to list_contexts. */
export interface WSContextListMessage {
  type: "context_list";
  contexts: Array<{
    peerName: string;
    summary: string;
    tags: string[];
    updatedAt: string;
  }>;
  _reqId?: string;
}

// --- Task messages ---

/** Client → broker: create a task. */
export interface WSCreateTaskMessage {
  type: "create_task";
  title: string;
  assignee?: string;
  priority?: string;
  tags?: string[];
}

/** Client → broker: claim an open task. */
export interface WSClaimTaskMessage {
  type: "claim_task";
  taskId: string;
}

/** Client → broker: mark a task as done. */
export interface WSCompleteTaskMessage {
  type: "complete_task";
  taskId: string;
  result?: string;
}

/** Client → broker: list tasks with optional filters. */
export interface WSListTasksMessage {
  type: "list_tasks";
  status?: string;
  assignee?: string;
}

/** Broker → client: acknowledgement for create_task. */
export interface WSTaskCreatedMessage {
  type: "task_created";
  id: string;
  _reqId?: string;
}

/** Broker → client: response to list_tasks, claim_task, complete_task. */
export interface WSTaskListMessage {
  type: "task_list";
  tasks: Array<{
    id: string;
    title: string;
    assignee: string | null;
    claimedBy: string | null;
    status: string;
    priority: string;
    createdBy: string | null;
    tags: string[];
    createdAt: string;
  }>;
  _reqId?: string;
}

// --- Stream messages ---

/** Client → broker: create a named real-time stream. */
export interface WSCreateStreamMessage {
  type: "create_stream";
  name: string;
}

/** Client → broker: publish data to a stream. */
export interface WSPublishMessage {
  type: "publish";
  stream: string;
  data: unknown;
}

/** Client → broker: subscribe to a stream. */
export interface WSSubscribeMessage {
  type: "subscribe";
  stream: string;
}

/** Client → broker: unsubscribe from a stream. */
export interface WSUnsubscribeMessage {
  type: "unsubscribe";
  stream: string;
}

/** Client → broker: list all streams in the mesh. */
export interface WSListStreamsMessage {
  type: "list_streams";
}

/** Broker → client: acknowledgement for create_stream. */
export interface WSStreamCreatedMessage {
  type: "stream_created";
  id: string;
  name: string;
  _reqId?: string;
}

/** Broker → client: real-time data pushed from a stream. */
export interface WSStreamDataMessage {
  type: "stream_data";
  stream: string;
  data: unknown;
  publishedBy: string;
}

/** Broker → client: confirmation that a stream subscription was registered. */
export interface WSSubscribedMessage {
  type: "subscribed";
  stream: string;
  _reqId?: string;
}

/** Broker → client: response to list_streams. */
export interface WSStreamListMessage {
  type: "stream_list";
  streams: Array<{
    id: string;
    name: string;
    createdBy: string;
    createdAt: string;
    subscriberCount: number;
  }>;
  _reqId?: string;
}

// --- MCP proxy messages ---

/** Client → broker: register an MCP server with the mesh. */
export interface WSMcpRegisterMessage {
  type: "mcp_register";
  serverName: string;
  description: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  persistent?: boolean;
  _reqId?: string;
}

/** Client → broker: unregister an MCP server. */
export interface WSMcpUnregisterMessage {
  type: "mcp_unregister";
  serverName: string;
  _reqId?: string;
}

/** Client → broker: list all MCP servers in the mesh. */
export interface WSMcpListMessage {
  type: "mcp_list";
  _reqId?: string;
}

/** Client → broker: call a tool on a mesh-registered MCP server. */
export interface WSMcpCallMessage {
  type: "mcp_call";
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  _reqId?: string;
}

/** Client → broker: response to a forwarded MCP call. */
export interface WSMcpCallResponseMessage {
  type: "mcp_call_response";
  callId: string;
  result?: unknown;
  error?: string;
  _reqId?: string;
}

/** Broker → client: acknowledgement for mcp_register. */
export interface WSMcpRegisterAckMessage {
  type: "mcp_register_ack";
  serverName: string;
  toolCount: number;
  _reqId?: string;
}

/** Broker → client: list of MCP servers in the mesh. */
export interface WSMcpListResultMessage {
  type: "mcp_list_result";
  servers: Array<{
    name: string;
    description: string;
    hostedBy: string;
    tools: Array<{ name: string; description: string }>;
    online: boolean;
    offlineSince?: string;
  }>;
  _reqId?: string;
}

/** Broker → client: result of an MCP tool call. */
export interface WSMcpCallResultMessage {
  type: "mcp_call_result";
  result?: unknown;
  error?: string;
  _reqId?: string;
}

/** Broker → client: forwarded MCP tool call to execute locally. */
export interface WSMcpCallForwardMessage {
  type: "mcp_call_forward";
  callId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  callerName: string;
}

// --- Webhook CRUD messages ---

/** Client → broker: create an inbound webhook. */
export interface WSCreateWebhookMessage {
  type: "create_webhook";
  name: string;
  _reqId?: string;
}

/** Client → broker: list webhooks for the mesh. */
export interface WSListWebhooksMessage {
  type: "list_webhooks";
  _reqId?: string;
}

/** Client → broker: deactivate a webhook. */
export interface WSDeleteWebhookMessage {
  type: "delete_webhook";
  name: string;
  _reqId?: string;
}

/** Broker → client: acknowledgement for create_webhook. */
export interface WSWebhookAckMessage {
  type: "webhook_ack";
  name: string;
  url: string;
  secret: string;
  _reqId?: string;
}

/** Broker → client: list of webhooks for the mesh. */
export interface WSWebhookListMessage {
  type: "webhook_list";
  webhooks: Array<{ name: string; url: string; active: boolean; createdAt: string }>;
  _reqId?: string;
}

// --- Peer file sharing (relay) messages ---

/** Client → broker: request a file from a peer's local filesystem. */
export interface WSPeerFileRequestMessage {
  type: "peer_file_request";
  targetPubkey: string;
  filePath: string;
  _reqId?: string;
}

/** Broker → target peer: forwarded file request from another peer. */
export interface WSPeerFileRequestForwardMessage {
  type: "peer_file_request_forward";
  requesterPubkey: string;
  filePath: string;
  _reqId?: string;
}

/** Target peer → broker: response with file content (or error). */
export interface WSPeerFileResponseMessage {
  type: "peer_file_response";
  requesterPubkey: string;
  filePath: string;
  content?: string; // base64 encoded
  error?: string;
  _reqId?: string;
}

/** Broker → requester: forwarded file content from target peer. */
export interface WSPeerFileResponseForwardMessage {
  type: "peer_file_response_forward";
  filePath: string;
  content?: string;
  error?: string;
  _reqId?: string;
}

/** Client → broker: request a directory listing from a peer. */
export interface WSPeerDirRequestMessage {
  type: "peer_dir_request";
  targetPubkey: string;
  dirPath: string;
  pattern?: string;
  _reqId?: string;
}

/** Broker → target peer: forwarded directory listing request. */
export interface WSPeerDirRequestForwardMessage {
  type: "peer_dir_request_forward";
  requesterPubkey: string;
  dirPath: string;
  pattern?: string;
  _reqId?: string;
}

/** Target peer → broker: directory listing response. */
export interface WSPeerDirResponseMessage {
  type: "peer_dir_response";
  requesterPubkey: string;
  dirPath: string;
  entries?: string[];
  error?: string;
  _reqId?: string;
}

/** Broker → requester: forwarded directory listing from target peer. */
export interface WSPeerDirResponseForwardMessage {
  type: "peer_dir_response_forward";
  dirPath: string;
  entries?: string[];
  error?: string;
  _reqId?: string;
}

/** Broker → client: structured error. */
export interface WSErrorMessage {
  type: "error";
  code: string;
  message: string;
  id?: string;
  _reqId?: string;
}

// --- Audit log messages ---

/** Client → broker: query paginated audit entries for a mesh. */
export interface WSAuditQueryMessage {
  type: "audit_query";
  limit?: number;
  offset?: number;
  eventType?: string;
  _reqId?: string;
}

/** Client → broker: verify the hash chain for the mesh audit log. */
export interface WSAuditVerifyMessage {
  type: "audit_verify";
  _reqId?: string;
}

/** Broker → client: paginated audit log entries. */
export interface WSAuditResultMessage {
  type: "audit_result";
  entries: Array<{
    id: number;
    eventType: string;
    actor: string;
    payload: Record<string, unknown>;
    hash: string;
    createdAt: string;
  }>;
  total: number;
  _reqId?: string;
}

/** Broker → client: result of hash chain verification. */
export interface WSAuditVerifyResultMessage {
  type: "audit_verify_result";
  valid: boolean;
  entries: number;
  brokenAt?: number;
  _reqId?: string;
}

// --- Simulation clock messages ---

/** Client → broker: set the simulation clock speed. */
export interface WSSetClockMessage {
  type: "set_clock";
  speed: number; // multiplier: 1, 2, 5, 10, 50, 100
  _reqId?: string;
}

/** Client → broker: pause the simulation clock. */
export interface WSPauseClockMessage {
  type: "pause_clock";
  _reqId?: string;
}

/** Client → broker: resume a paused simulation clock. */
export interface WSResumeClockMessage {
  type: "resume_clock";
  _reqId?: string;
}

/** Client → broker: get current clock status. */
export interface WSGetClockMessage {
  type: "get_clock";
  _reqId?: string;
}

/** Broker → client: current simulation clock status. */
export interface WSClockStatusMessage {
  type: "clock_status";
  speed: number;
  paused: boolean;
  tick: number;
  simTime: string; // ISO timestamp
  startedAt: string;
  _reqId?: string;
}

// --- Scheduled messages ---

/** Client → broker: schedule a message for future delivery. */
export interface WSScheduleMessage {
  type: "schedule";
  to: string;
  message: string;
  /** Unix timestamp (ms) when to deliver. Ignored for cron schedules. */
  deliverAt: number;
  /** Optional semantic tag — "reminder" surfaces differently to the receiver. */
  subtype?: "reminder";
  /** Standard 5-field cron expression for recurring delivery. */
  cron?: string;
  /** Whether this is a recurring schedule. Implied true when `cron` is set. */
  recurring?: boolean;
  _reqId?: string;
}

/** Client → broker: list pending scheduled messages for this member. */
export interface WSListScheduledMessage {
  type: "list_scheduled";
  _reqId?: string;
}

/** Client → broker: cancel a scheduled message by id. */
export interface WSCancelScheduledMessage {
  type: "cancel_scheduled";
  scheduledId: string;
  _reqId?: string;
}

/** Broker → client: acknowledgement for schedule, carries the assigned id. */
export interface WSScheduledAckMessage {
  type: "scheduled_ack";
  scheduledId: string;
  deliverAt: number;
  /** Present for cron schedules — echoes the expression. */
  cron?: string;
  _reqId?: string;
}

/** Broker → client: list of pending scheduled messages. */
export interface WSScheduledListMessage {
  type: "scheduled_list";
  messages: Array<{
    id: string;
    to: string;
    message: string;
    deliverAt: number;
    createdAt: number;
    /** Present for cron/recurring entries. */
    cron?: string;
    /** Number of times the cron entry has fired so far. */
    firedCount?: number;
  }>;
  _reqId?: string;
}

/** Broker → client: cancel confirmation. */
export interface WSCancelScheduledAckMessage {
  type: "cancel_scheduled_ack";
  scheduledId: string;
  ok: boolean;
  _reqId?: string;
}

/** Client → broker: deploy an MCP server from zip or git. */
export interface WSMcpDeployMessage { type: "mcp_deploy"; server_name: string; source: { type: "zip"; file_id: string } | { type: "git"; url: string; branch?: string; auth?: string }; config?: { env?: Record<string, string>; memory_mb?: number; cpus?: number; network_allow?: string[]; runtime?: "node" | "python" | "bun" }; scope?: "peer" | "mesh" | { peers: string[] } | { group: string } | { groups: string[] } | { role: string }; _reqId?: string; }
/** Client → broker: stop and remove a managed MCP server. */
export interface WSMcpUndeployMessage { type: "mcp_undeploy"; server_name: string; _reqId?: string; }
/** Client → broker: pull + rebuild + restart a git-sourced MCP. */
export interface WSMcpUpdateMessage { type: "mcp_update"; server_name: string; _reqId?: string; }
/** Client → broker: get logs from a managed MCP. */
export interface WSMcpLogsMessage { type: "mcp_logs"; server_name: string; lines?: number; _reqId?: string; }
/** Client → broker: get or set visibility scope. */
export interface WSMcpScopeMessage { type: "mcp_scope"; server_name: string; scope?: "peer" | "mesh" | { peers: string[] } | { group: string } | { groups: string[] } | { role: string }; _reqId?: string; }
/** Client → broker: inspect tool schemas for a deployed service. */
export interface WSMcpSchemaMessage { type: "mcp_schema"; server_name: string; tool_name?: string; _reqId?: string; }
/** Client → broker: list all deployed services. */
export interface WSMcpCatalogMessage { type: "mcp_catalog"; _reqId?: string; }
/** Client → broker: deploy a skill bundle from zip or git. */
export interface WSSkillDeployMessage { type: "skill_deploy"; source: { type: "zip"; file_id: string } | { type: "git"; url: string; branch?: string; auth?: string }; _reqId?: string; }
/** Client → broker: store encrypted credential. */
export interface WSVaultSetMessage { type: "vault_set"; key: string; ciphertext: string; nonce: string; sealed_key: string; entry_type: "env" | "file"; mount_path?: string; description?: string; _reqId?: string; }
/** Client → broker: list vault entries. */
export interface WSVaultListMessage { type: "vault_list"; _reqId?: string; }
/** Client → broker: delete vault entry. */
export interface WSVaultDeleteMessage { type: "vault_delete"; key: string; _reqId?: string; }
/** Client → broker: fetch encrypted vault entries for local decryption. */
export interface WSVaultGetMessage { type: "vault_get"; keys: string[]; _reqId?: string; }

/** Client → broker: start watching a URL for changes. */
export interface WSWatchMessage { type: "watch"; url: string; mode?: "hash" | "json" | "status"; extract?: string; interval?: number; notify_on?: string; headers?: Record<string, string>; label?: string; _reqId?: string; }
/** Client → broker: stop watching. */
export interface WSUnwatchMessage { type: "unwatch"; watchId: string; _reqId?: string; }
/** Client → broker: list active watches. */
export interface WSWatchListMessage { type: "watch_list"; _reqId?: string; }
/** Broker → client: watch created acknowledgement. */
export interface WSWatchAckMessage { type: "watch_ack"; watchId: string; url: string; mode: string; interval: number; _reqId?: string; }
/** Broker → client: watch list response. */
export interface WSWatchListResultMessage { type: "watch_list_result"; watches: Array<{ id: string; url: string; mode: string; label?: string; interval: number; lastHash?: string; lastValue?: string; lastCheck?: string; createdAt: string }>; _reqId?: string; }
/** Broker → client: URL change detected. */
export interface WSWatchTriggeredMessage { type: "watch_triggered"; watchId: string; url: string; label?: string; mode: string; oldValue: string; newValue: string; timestamp: string; }

export type WSClientMessage =
  | WSHelloMessage
  | WSSendMessage
  | WSSetStatusMessage
  | WSListPeersMessage
  | WSSetSummaryMessage
  | WSSetVisibleMessage
  | WSSetProfileMessage
  | WSJoinGroupMessage
  | WSLeaveGroupMessage
  | WSTopicCreateMessage
  | WSTopicListMessage
  | WSTopicJoinMessage
  | WSTopicLeaveMessage
  | WSTopicMembersMessage
  | WSTopicHistoryMessage
  | WSTopicMarkReadMessage
  | WSApiKeyCreateMessage
  | WSApiKeyListMessage
  | WSApiKeyRevokeMessage
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
  | WSDeleteFileMessage
  | WSGrantFileAccessMessage
  | WSShareContextMessage
  | WSGetContextMessage
  | WSListContextsMessage
  | WSCreateTaskMessage
  | WSClaimTaskMessage
  | WSCompleteTaskMessage
  | WSListTasksMessage
  | WSVectorStoreMessage
  | WSVectorSearchMessage
  | WSVectorDeleteMessage
  | WSListCollectionsMessage
  | WSGraphQueryMessage
  | WSGraphExecuteMessage
  | WSMeshQueryMessage
  | WSMeshExecuteMessage
  | WSMeshSchemaMessage
  | WSCreateStreamMessage
  | WSPublishMessage
  | WSSubscribeMessage
  | WSUnsubscribeMessage
  | WSListStreamsMessage
  | WSMeshInfoMessage
  | WSSetClockMessage
  | WSPauseClockMessage
  | WSResumeClockMessage
  | WSGetClockMessage
  | WSScheduleMessage
  | WSListScheduledMessage
  | WSCancelScheduledMessage
  | WSMcpRegisterMessage
  | WSMcpUnregisterMessage
  | WSMcpListMessage
  | WSMcpCallMessage
  | WSMcpCallResponseMessage
  | WSShareSkillMessage
  | WSGetSkillMessage
  | WSListSkillsMessage
  | WSRemoveSkillMessage
  | WSSetStatsMessage
  | WSCreateWebhookMessage
  | WSListWebhooksMessage
  | WSDeleteWebhookMessage
  | WSPeerFileRequestMessage
  | WSPeerFileResponseMessage
  | WSPeerDirRequestMessage
  | WSPeerDirResponseMessage
  | WSAuditQueryMessage
  | WSAuditVerifyMessage
  | WSMcpDeployMessage
  | WSMcpUndeployMessage
  | WSMcpUpdateMessage
  | WSMcpLogsMessage
  | WSMcpScopeMessage
  | WSMcpSchemaMessage
  | WSMcpCatalogMessage
  | WSSkillDeployMessage
  | WSVaultSetMessage
  | WSVaultListMessage
  | WSVaultDeleteMessage
  | WSVaultGetMessage
  | WSWatchMessage
  | WSUnwatchMessage
  | WSWatchListMessage;

// --- Skill messages ---

/** Client → broker: publish or update a skill. */
export interface WSShareSkillMessage {
  type: "share_skill";
  name: string;
  description: string;
  instructions: string;
  tags?: string[];
  _reqId?: string;
}

/** Client → broker: load a skill by name. */
export interface WSGetSkillMessage {
  type: "get_skill";
  name: string;
  _reqId?: string;
}

/** Client → broker: list skills, optionally filtered by keyword. */
export interface WSListSkillsMessage {
  type: "list_skills";
  query?: string;
  _reqId?: string;
}

/** Client → broker: remove a skill by name. */
export interface WSRemoveSkillMessage {
  type: "remove_skill";
  name: string;
  _reqId?: string;
}

/** Broker → client: acknowledgement for share_skill or remove_skill. */
export interface WSSkillAckMessage {
  type: "skill_ack";
  name: string;
  action: "shared" | "removed" | "not_found";
  _reqId?: string;
}

/** Broker → client: response to get_skill with full skill data. */
export interface WSSkillDataMessage {
  type: "skill_data";
  skill: {
    name: string;
    description: string;
    instructions: string;
    tags: string[];
    author: string;
    createdAt: string;
  } | null;
  _reqId?: string;
}

/** Broker → client: response to list_skills. */
export interface WSSkillListMessage {
  type: "skill_list";
  skills: Array<{
    name: string;
    description: string;
    tags: string[];
    author: string;
    createdAt: string;
  }>;
  _reqId?: string;
}

/** Broker → client: deployment progress/result. */
export interface WSMcpDeployStatusMessage { type: "mcp_deploy_status"; server_name: string; status: "building" | "installing" | "running" | "failed"; tools?: Array<{ name: string; description: string; inputSchema: object }>; error?: string; _reqId?: string; }
/** Broker → client: service log output. */
export interface WSMcpLogsResultMessage { type: "mcp_logs_result"; server_name: string; lines: string[]; _reqId?: string; }
/** Broker → client: tool schema introspection result. */
export interface WSMcpSchemaResultMessage { type: "mcp_schema_result"; server_name: string; tools: Array<{ name: string; description: string; inputSchema: object }>; _reqId?: string; }
/** Broker → client: full service catalog. */
export interface WSMcpCatalogResultMessage { type: "mcp_catalog_result"; services: Array<{ name: string; type: "mcp" | "skill"; description: string; status: string; tool_count: number; deployed_by: string; scope: { type: string; [key: string]: unknown }; source_type: string; runtime?: string; created_at: string }>; _reqId?: string; }
/** Broker → client: scope query/set result. */
export interface WSMcpScopeResultMessage { type: "mcp_scope_result"; server_name: string; scope: { type: string; [key: string]: unknown }; deployed_by: string; _reqId?: string; }
/** Broker → client: skill deploy acknowledgement. */
export interface WSSkillDeployAckMessage { type: "skill_deploy_ack"; name: string; files: string[]; _reqId?: string; }
/** Broker → client: vault operation acknowledgement. */
export interface WSVaultAckMessage { type: "vault_ack"; key: string; action: "stored" | "deleted" | "not_found"; _reqId?: string; }
/** Broker → client: vault entry listing. */
export interface WSVaultListResultMessage { type: "vault_list_result"; entries: Array<{ key: string; entry_type: "env" | "file"; mount_path?: string; description?: string; updated_at: string }>; _reqId?: string; }
/** Broker → client: encrypted vault entries for local decryption. */
export interface WSVaultGetResultMessage { type: "vault_get_result"; entries: Array<{ key: string; ciphertext: string; nonce: string; sealed_key: string; entry_type: string; mount_path?: string }>; _reqId?: string; }

export type WSServerMessage =
  | WSHelloAckMessage
  | WSPushMessage
  | WSAckMessage
  | WSPeersListMessage
  | WSTopicCreatedMessage
  | WSTopicListResponseMessage
  | WSTopicMembersResponseMessage
  | WSTopicHistoryResponseMessage
  | WSApiKeyCreatedMessage
  | WSApiKeyListResponseMessage
  | WSApiKeyRevokeResponseMessage
  | WSStateChangeMessage
  | WSStateResultMessage
  | WSStateListMessage
  | WSMemoryStoredMessage
  | WSMemoryResultsMessage
  | WSMessageStatusResultMessage
  | WSFileUrlMessage
  | WSFileListMessage
  | WSFileStatusResultMessage
  | WSGrantFileAccessOkMessage
  | WSContextSharedMessage
  | WSContextResultsMessage
  | WSContextListMessage
  | WSTaskCreatedMessage
  | WSTaskListMessage
  | WSVectorStoredMessage
  | WSVectorResultsMessage
  | WSCollectionListMessage
  | WSGraphResultMessage
  | WSMeshQueryResultMessage
  | WSMeshSchemaResultMessage
  | WSStreamCreatedMessage
  | WSStreamDataMessage
  | WSSubscribedMessage
  | WSStreamListMessage
  | WSMeshInfoResultMessage
  | WSScheduledAckMessage
  | WSScheduledListMessage
  | WSCancelScheduledAckMessage
  | WSMcpRegisterAckMessage
  | WSMcpListResultMessage
  | WSMcpCallResultMessage
  | WSMcpCallForwardMessage
  | WSClockStatusMessage
  | WSSkillAckMessage
  | WSSkillDataMessage
  | WSSkillListMessage
  | WSWebhookAckMessage
  | WSWebhookListMessage
  | WSPeerFileRequestForwardMessage
  | WSPeerFileResponseForwardMessage
  | WSPeerDirRequestForwardMessage
  | WSPeerDirResponseForwardMessage
  | WSAuditResultMessage
  | WSAuditVerifyResultMessage
  | WSMcpDeployStatusMessage
  | WSMcpLogsResultMessage
  | WSMcpSchemaResultMessage
  | WSMcpCatalogResultMessage
  | WSMcpScopeResultMessage
  | WSSkillDeployAckMessage
  | WSVaultAckMessage
  | WSVaultListResultMessage
  | WSVaultGetResultMessage
  | WSWatchAckMessage
  | WSWatchListResultMessage
  | WSWatchTriggeredMessage
  | WSErrorMessage;
