/**
 * Call the broker's POST /cli-sync endpoint to sync dashboard meshes.
 *
 * Takes a sync JWT (from the browser callback) and a freshly generated
 * ed25519 keypair. The broker creates member rows and returns mesh details.
 */

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

/**
 * Sync meshes from dashboard via broker.
 *
 * @param syncToken - JWT from the browser sync flow
 * @param peerPubkey - ed25519 public key hex (64 chars)
 * @param displayName - display name for the new member
 * @param brokerBaseUrl - HTTPS base URL of the broker (derived from WSS URL)
 */
export async function syncWithBroker(
  syncToken: string,
  peerPubkey: string,
  displayName: string,
  brokerBaseUrl?: string,
): Promise<SyncResult> {
  // Default broker URL — derive HTTPS from WSS
  const base = brokerBaseUrl ?? deriveHttpUrl(
    process.env.CLAUDEMESH_BROKER_URL ?? "wss://ic.claudemesh.com/ws",
  );

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
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {
      msg = body;
    }
    throw new Error(`Broker sync failed (${res.status}): ${msg}`);
  }

  const body = (await res.json()) as { ok: boolean; account_id?: string; meshes?: SyncResult["meshes"]; error?: string };

  if (!body.ok) {
    throw new Error(`Broker sync failed: ${body.error ?? "unknown error"}`);
  }

  return {
    account_id: body.account_id!,
    meshes: body.meshes!,
  };
}

/**
 * Convert a WSS broker URL to an HTTPS base URL.
 * wss://ic.claudemesh.com/ws → https://ic.claudemesh.com
 * ws://localhost:3001/ws → http://localhost:3001
 */
function deriveHttpUrl(wssUrl: string): string {
  const url = new URL(wssUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  // Remove /ws path suffix
  url.pathname = url.pathname.replace(/\/ws\/?$/, "");
  // Remove trailing slash
  return url.toString().replace(/\/$/, "");
}
