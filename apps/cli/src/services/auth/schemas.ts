export interface StoredAuth {
  session_token: string;
  user: {
    id: string;
    display_name: string;
    email: string;
  };
  token_source: "device-code" | "callback" | "manual";
  stored_at: string;
}

export interface WhoAmIResult {
  signed_in: boolean;
  user?: {
    id: string;
    display_name: string;
    email: string;
  };
  token_source?: string;
  meshes?: { owned: number; guest: number };
  /**
   * Local mesh memberships from ~/.claudemesh/config.json. Always present
   * when the config has any mesh entries, regardless of whether a web
   * session is also signed in. Lets `claudemesh whoami` show useful
   * identity info for users who joined via invite without ever signing
   * in to claudemesh.com.
   */
  local?: {
    config_path: string;
    meshes: Array<{ slug: string; mesh_id: string; member_id: string; pubkey_prefix: string }>;
  };
}
