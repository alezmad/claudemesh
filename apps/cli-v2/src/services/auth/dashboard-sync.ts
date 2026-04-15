import { URLS } from "~/constants/urls.js";

export interface SyncResult {
  account_id: string;
  meshes: Array<{
    mesh_id: string;
    slug: string;
    broker_url: string;
    member_id: string;
    role: "admin" | "member";
  }>;
}

export async function syncWithBroker(
  syncToken: string,
  peerPubkey: string,
  displayName: string,
  brokerBaseUrl?: string,
): Promise<SyncResult> {
  const base = brokerBaseUrl ?? deriveHttpUrl(URLS.BROKER);

  const res = await fetch(`${base}/cli-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sync_token: syncToken,
      peer_pubkey: peerPubkey,
      display_name: displayName,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let msg: string;
    try { msg = (JSON.parse(body) as { error?: string }).error ?? body; } catch { msg = body; }
    throw new Error(`Broker sync failed (${res.status}): ${msg}`);
  }

  const body = (await res.json()) as { ok: boolean; account_id?: string; meshes?: SyncResult["meshes"]; error?: string };
  if (!body.ok) throw new Error(`Broker sync failed: ${body.error ?? "unknown error"}`);

  return { account_id: body.account_id!, meshes: body.meshes! };
}

function deriveHttpUrl(wssUrl: string): string {
  const url = new URL(wssUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/ws\/?$/, "");
  return url.toString().replace(/\/$/, "");
}
