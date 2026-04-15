import { request } from "~/services/api/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { URLS } from "~/constants/urls.js";

const BROKER_HTTP = URLS.BROKER.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");

export async function generateInvite(
  meshSlug: string,
  opts?: { email?: string; expires_in?: string; max_uses?: number; role?: string },
): Promise<{ url: string; code: string; expires_at: string; emailed?: boolean }> {
  const auth = getStoredToken();
  if (!auth) throw new Error("Not signed in");

  let userId = "";
  try {
    const payload = JSON.parse(Buffer.from(auth.session_token.split(".")[1]!, "base64url").toString()) as { sub?: string };
    userId = payload.sub ?? "";
  } catch {}
  if (!userId) throw new Error("Invalid token");

  return request<{ url: string; code: string; expires_at: string; emailed?: boolean }>({
    path: `/cli/mesh/${meshSlug}/invite`,
    method: "POST",
    body: { user_id: userId, email: opts?.email, role: opts?.role },
    baseUrl: BROKER_HTTP,
  });
}
