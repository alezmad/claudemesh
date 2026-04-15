export interface ApiResponse<T> { ok: boolean; data?: T; error?: string; }

export interface DeviceCodeResponse { device_code: string; user_code: string; expires_at: string; verification_url: string; }

export interface SessionTokenResponse { session_token: string; user: { id: string; display_name: string; email: string }; }

export interface MeshCreateRequest { name: string; slug?: string; template?: string; description?: string; }

export interface InviteCreateRequest { email?: string; expires_in?: string; max_uses?: number; role?: string; }

export interface InviteResponse { url: string; code: string; expires_at: string; }
