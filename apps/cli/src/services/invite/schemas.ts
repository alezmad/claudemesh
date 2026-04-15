export interface InviteInfo {
  code: string;
  url: string;
  mesh_slug: string;
  expires_at: string;
  max_uses?: number;
  role?: string;
}
