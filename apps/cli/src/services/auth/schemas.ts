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
}
