/**
 * MCP tool definitions exposed to Claude Code.
 *
 * Mirror the claude-intercom tool surface: send_message, list_peers,
 * check_messages, set_summary, set_status. Tools return "not
 * connected" errors until 15b wires the WS client.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "send_message",
    description:
      "Send a message to a peer in one of your joined meshes. `to` can be a peer display name (resolved via list_peers), hex pubkey, @group, `#channel`, or `*` for broadcast. `priority` controls delivery: `now` bypasses busy gates, `next` waits for idle (default), `low` is pull-only.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          oneOf: [
            { type: "string", description: "Peer name, pubkey, @group" },
            { type: "array", items: { type: "string" }, description: "Multiple targets" },
          ],
          description: "Single target or array of targets",
        },
        message: { type: "string", description: "Message text" },
        priority: {
          type: "string",
          enum: ["now", "next", "low"],
          description: "Delivery priority (default: next)",
        },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "list_peers",
    description:
      "List peers across all joined meshes. Shows name, mesh, status (idle/working/dnd), and current summary.",
    inputSchema: {
      type: "object",
      properties: {
        mesh_slug: {
          type: "string",
          description: "Only list peers in this mesh (optional)",
        },
      },
    },
  },
  {
    name: "message_status",
    description:
      "Check the delivery status of a sent message. Shows whether each recipient received it.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Message ID (returned by send_message)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "check_messages",
    description:
      "Pull any undelivered messages from the broker. Normally messages arrive via push; use this to drain the queue after being offline.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_summary",
    description:
      "Set a 1–2 sentence summary of what you're working on. Visible to other peers.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "1-2 sentence summary" },
      },
      required: ["summary"],
    },
  },
  {
    name: "set_status",
    description:
      "Manually override your status. `dnd` blocks everything except `now`-priority messages.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["idle", "working", "dnd"],
          description: "Your status",
        },
      },
      required: ["status"],
    },
  },
  {
    name: "join_group",
    description:
      "Join a group with an optional role. Other peers see your group membership in list_peers.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Group name (without @)" },
        role: {
          type: "string",
          description: "Your role in the group (e.g. lead, member, observer)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "leave_group",
    description: "Leave a group.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Group name (without @)" },
      },
      required: ["name"],
    },
  },

  // --- State tools ---
  {
    name: "set_state",
    description:
      "Set a shared state value visible to all peers in the mesh. Pushes a change notification.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { description: "Any JSON value" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "get_state",
    description: "Read a shared state value.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
    },
  },
  {
    name: "list_state",
    description: "List all shared state keys and values in the mesh.",
    inputSchema: { type: "object", properties: {} },
  },

  // --- Memory tools ---
  {
    name: "remember",
    description:
      "Store persistent knowledge in the mesh's shared memory. Survives across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The knowledge to remember",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional categorization tags",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "recall",
    description: "Search the mesh's shared memory by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "forget",
    description: "Remove a memory from the mesh's shared knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to forget" },
      },
      required: ["id"],
    },
  },

  // --- File tools ---
  {
    name: "share_file",
    description:
      "Share a persistent file with the mesh. All current and future peers can access it. If `to` is specified, the file is E2E encrypted and only accessible to that peer (and you).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Local file path to share" },
        name: {
          type: "string",
          description: "Display name (defaults to filename)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
        to: {
          type: "string",
          description: "Peer display name or pubkey hex — if set, file is E2E encrypted for this peer only",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "get_file",
    description: "Download a shared file to a local path.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "File ID" },
        save_to: {
          type: "string",
          description: "Local path to save the file",
        },
      },
      required: ["id", "save_to"],
    },
  },
  {
    name: "list_files",
    description: "List files shared in the mesh.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search by name or tags" },
        from: { type: "string", description: "Filter by uploader name" },
      },
    },
  },
  {
    name: "file_status",
    description: "Check who has accessed a shared file.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "File ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_file",
    description: "Remove a shared file from the mesh.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "File ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "grant_file_access",
    description: "Grant a peer access to an E2E encrypted file you shared. You must be the owner.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "File ID" },
        to: { type: "string", description: "Peer display name or pubkey hex to grant access to" },
      },
      required: ["fileId", "to"],
    },
  },

  // --- Vector tools ---
  {
    name: "vector_store",
    description:
      "Store an embedding in a per-mesh Qdrant collection. Auto-creates the collection on first use.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", description: "Collection name" },
        text: { type: "string", description: "Text to embed and store" },
        metadata: {
          type: "object",
          description: "Optional metadata to attach",
        },
      },
      required: ["collection", "text"],
    },
  },
  {
    name: "vector_search",
    description: "Semantic search over stored embeddings in a collection.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", description: "Collection name" },
        query: { type: "string", description: "Search query text" },
        limit: {
          type: "number",
          description: "Max results (default: 10)",
        },
      },
      required: ["collection", "query"],
    },
  },
  {
    name: "vector_delete",
    description: "Remove an embedding from a collection.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", description: "Collection name" },
        id: { type: "string", description: "Embedding ID to delete" },
      },
      required: ["collection", "id"],
    },
  },
  {
    name: "list_collections",
    description: "List vector collections in this mesh.",
    inputSchema: { type: "object", properties: {} },
  },

  // --- Graph tools ---
  {
    name: "graph_query",
    description:
      "Run a read-only Cypher query on the per-mesh Neo4j database.",
    inputSchema: {
      type: "object",
      properties: {
        cypher: { type: "string", description: "Cypher MATCH query" },
      },
      required: ["cypher"],
    },
  },
  {
    name: "graph_execute",
    description:
      "Run a write Cypher query (CREATE, MERGE, DELETE) on the per-mesh Neo4j database.",
    inputSchema: {
      type: "object",
      properties: {
        cypher: { type: "string", description: "Cypher write query" },
      },
      required: ["cypher"],
    },
  },

  // --- Mesh Database tools ---
  {
    name: "mesh_query",
    description:
      "Run a SELECT query on the per-mesh shared database.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL SELECT query" },
      },
      required: ["sql"],
    },
  },
  {
    name: "mesh_execute",
    description:
      "Run DDL/DML on the per-mesh database (CREATE TABLE, INSERT, UPDATE, DELETE).",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL statement" },
      },
      required: ["sql"],
    },
  },
  {
    name: "mesh_schema",
    description:
      "List tables and columns in the per-mesh shared database.",
    inputSchema: { type: "object", properties: {} },
  },

  // --- Stream tools ---
  {
    name: "create_stream",
    description:
      "Create a real-time data stream in the mesh.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Stream name" },
      },
      required: ["name"],
    },
  },
  {
    name: "publish",
    description:
      "Push data to a stream. Subscribers receive it in real-time.",
    inputSchema: {
      type: "object",
      properties: {
        stream: { type: "string", description: "Stream name" },
        data: { description: "Any JSON data to publish" },
      },
      required: ["stream", "data"],
    },
  },
  {
    name: "subscribe",
    description:
      "Subscribe to a stream. Data pushes arrive as channel notifications.",
    inputSchema: {
      type: "object",
      properties: {
        stream: { type: "string", description: "Stream name" },
      },
      required: ["stream"],
    },
  },
  {
    name: "list_streams",
    description:
      "List active streams in the mesh.",
    inputSchema: { type: "object", properties: {} },
  },

  // --- Context tools ---
  {
    name: "share_context",
    description:
      "Share your session understanding with the mesh. Call after exploring a codebase area.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of what you explored/learned",
        },
        files_read: {
          type: "array",
          items: { type: "string" },
          description: "File paths you read",
        },
        key_findings: {
          type: "array",
          items: { type: "string" },
          description: "Key findings or insights",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "get_context",
    description:
      "Find context from peers who explored an area. Check before re-reading files another peer already analyzed.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (file path, topic, etc.)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_contexts",
    description: "See what all peers currently know about the codebase.",
    inputSchema: { type: "object", properties: {} },
  },

  // --- Task tools ---
  {
    name: "create_task",
    description: "Create a work item for the mesh.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        assignee: {
          type: "string",
          description: "Peer name to assign (optional)",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Priority level (default: normal)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "claim_task",
    description: "Claim an unclaimed task to take ownership.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as done with an optional result summary.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        result: {
          type: "string",
          description: "Summary of what was done",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_tasks",
    description: "List tasks filtered by status and/or assignee.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "claimed", "completed"],
          description: "Filter by status",
        },
        assignee: {
          type: "string",
          description: "Filter by assignee name",
        },
      },
    },
  },

  // --- Mesh info ---
  {
    name: "mesh_info",
    description:
      "Get a complete overview of the mesh: peers, groups, state, memory, files, tasks, streams, tables. Call on session start for full situational awareness.",
    inputSchema: { type: "object", properties: {} },
  },

  // --- Diagnostics ---
  {
    name: "ping_mesh",
    description:
      "Send test messages through the full pipeline and measure round-trip timing per priority. Diagnoses push delivery issues.",
    inputSchema: {
      type: "object",
      properties: {
        priorities: {
          type: "array",
          items: { type: "string", enum: ["now", "next", "low"] },
          description: "Priorities to test (default: [\"now\", \"next\"])",
        },
      },
    },
  },
];
