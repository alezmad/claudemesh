export interface Mesh { id: string; slug: string; name: string; role: "owner" | "admin" | "member" | "guest"; broker_url: string; member_count: number; }

export interface MeshMember { id: string; pubkey: string; display_name: string; status: string; summary?: string; groups: string[]; }

export interface MeshInvite { code: string; mesh_slug: string; role: string; expires_at: string; max_uses: number; uses: number; }
