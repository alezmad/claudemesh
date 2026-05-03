import { get, post, del, request } from "./client.js";
import type { RequestOpts } from "./client.js";

export async function getProfile(token: string) {
  return get<{ id: string; display_name: string; email: string }>("/api/my/profile", token);
}

export async function getMeshes(token: string) {
  return get<Array<{ id: string; slug: string; name: string; role: string; member_count: number }>>(
    "/api/my/meshes",
    token,
  );
}

export async function createMesh(
  token: string,
  body: { name: string; slug?: string; template?: string; description?: string },
) {
  return post<{ id: string; slug: string; name: string }>("/api/my/meshes", body, token);
}

export async function renameMesh(token: string, oldSlug: string, newSlug: string) {
  // Routed through /api/cli/* (not /api/my/*) because the CLI JWT
  // can't authenticate against the better-auth-protected myRouter.
  // The /api/cli/meshes/:slug route validates the JWT inline.
  // v0.7.0 collapse: rename = change slug. mesh.name kept in sync
  // server-side (column stays for now, value mirrors slug).
  return request<{ slug: string }>({
    path: `/api/cli/meshes/${oldSlug}`,
    method: "PATCH",
    body: { slug: newSlug },
    token,
  });
}

export async function createInvite(
  token: string,
  meshSlug: string,
  body: { email?: string; expires_in?: string; max_uses?: number; role?: string },
) {
  return post<{ url: string; code: string; expires_at: string }>(
    `/api/my/meshes/${meshSlug}/invites`,
    body,
    token,
  );
}

export async function revokeSession(token: string) {
  const BROKER_HTTP = (await import("~/constants/urls.js")).URLS.BROKER
    .replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");
  return request<{ ok: boolean }>({
    path: "/cli/session/revoke",
    method: "POST",
    body: { token },
    baseUrl: BROKER_HTTP,
  });
}

export async function cliSync(token: string) {
  return post<{ meshes: Array<{ meshId: string; slug: string; name: string; brokerUrl: string }> }>(
    "/cli-sync",
    undefined,
    token,
  );
}
