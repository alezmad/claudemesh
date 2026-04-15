import { request } from "~/services/api/facade.js";
import { getStoredToken } from "~/services/auth/facade.js";
import { generateKeypair } from "~/services/crypto/facade.js";
import { setMeshConfig } from "~/services/config/facade.js";
import { URLS } from "~/constants/urls.js";
import type { JoinedMesh } from "~/services/config/facade.js";

const BROKER_HTTP = URLS.BROKER.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");

export async function createMesh(name: string, opts?: { template?: string; description?: string }): Promise<{ slug: string; id: string }> {
  const auth = getStoredToken();
  if (!auth) throw new Error("Not signed in");

  // Generate keypair first so we can send the pubkey to the broker
  const kp = await generateKeypair();

  // Broker authenticates via Authorization: Bearer <session_token>.
  // user_id used to be in the body but is now derived from the verified
  // session on the server. Older broker deploys still accept both.
  const result = await request<{ id: string; slug: string; name: string; member_id: string }>({
    path: "/cli/mesh/create",
    method: "POST",
    body: { name, pubkey: kp.publicKey, ...opts },
    baseUrl: BROKER_HTTP,
    token: auth.session_token,
  });

  const mesh: JoinedMesh = {
    meshId: result.id,
    memberId: result.member_id,
    slug: result.slug,
    name: result.name,
    pubkey: kp.publicKey,
    secretKey: kp.secretKey,
    brokerUrl: URLS.BROKER,
    joinedAt: new Date().toISOString(),
  };
  setMeshConfig(result.slug, mesh);
  return { slug: result.slug, id: result.id };
}
