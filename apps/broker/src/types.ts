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

/** Broker → client: vector search results. */
export interface WSVectorResultsMessage {
  type: "vector_results";
  results: Array<{
    id: string;
    text: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
}

/** Broker → client: list of vector collections. */
export interface WSCollectionListMessage {
  type: "collection_list";
  collections: string[];
}

/** Broker → client: graph query results. */
export interface WSGraphResultMessage {
  type: "graph_result";
  records: Array<Record<string, unknown>>;
}

/** Broker → client: mesh SQL query results. */
export interface WSMeshQueryResultMessage {
  type: "mesh_query_result";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

/** Broker → client: mesh schema introspection results. */
export interface WSMeshSchemaResultMessage {
  type: "mesh_schema_result";
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
  }>;
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
}

/** Broker → client: real-time data pushed from a stream. */
export interface WSStreamDataMessage {
  type: "stream_data";
  stream: string;
  data: unknown;
  publishedBy: string;
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
  | WSDeleteFileMessage
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
  | WSMeshInfoMessage;

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
  | WSContextSharedMessage
  | WSContextResultsMessage
  | WSContextListMessage
  | WSTaskCreatedMessage
  | WSTaskListMessage
  | WSVectorResultsMessage
  | WSCollectionListMessage
  | WSGraphResultMessage
  | WSMeshQueryResultMessage
  | WSMeshSchemaResultMessage
  | WSStreamCreatedMessage
  | WSStreamDataMessage
  | WSStreamListMessage
  | WSMeshInfoResultMessage
  | WSErrorMessage;
