/**
 * MCP tool schemas + shared types for the CLI's MCP server.
 */

export type Priority = "now" | "next" | "low";
export type PeerStatus = "idle" | "working" | "dnd";

export interface SendMessageArgs {
  to: string | string[]; // peer name, pubkey, @group, or array of targets
  message: string;
  priority?: Priority;
}

export interface ListPeersArgs {
  mesh_slug?: string; // filter to one joined mesh
}

export interface SetSummaryArgs {
  summary: string;
}

export interface SetStatusArgs {
  status: PeerStatus;
}

// --- Service deployment types ---

export type ServiceScope =
  | "peer"
  | "mesh"
  | { peers: string[] }
  | { group: string }
  | { groups: string[] }
  | { role: string };

export interface ServiceInfo {
  name: string;
  type: "mcp" | "skill";
  description: string;
  status: string;
  tool_count: number;
  deployed_by: string;
  scope: ServiceScope;
  source_type: string;
  runtime?: string;
  created_at: string;
}

export interface ServiceToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface VaultEntry {
  key: string;
  entry_type: "env" | "file";
  mount_path?: string;
  description?: string;
  updated_at: string;
}

export interface MeshMcpDeployArgs {
  server_name: string;
  file_id?: string;
  git_url?: string;
  git_branch?: string;
  env?: Record<string, string>;
  runtime?: "node" | "python" | "bun";
  memory_mb?: number;
  network_allow?: string[];
  scope?: ServiceScope;
}

export interface VaultSetArgs {
  key: string;
  value: string;
  type?: "env" | "file";
  mount_path?: string;
  description?: string;
}
