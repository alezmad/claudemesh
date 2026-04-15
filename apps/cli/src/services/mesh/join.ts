import { pub } from "~/services/api/facade.js";
import { generateKeypair } from "~/services/crypto/facade.js";
import { setMeshConfig } from "~/services/config/facade.js";
import { URLS } from "~/constants/urls.js";
import type { JoinedMesh } from "~/services/config/facade.js";

export async function joinMesh(code: string, displayName: string): Promise<JoinedMesh> {
  const kp = await generateKeypair();
  const result = await pub.claimInvite(code, { pubkey: kp.publicKey, display_name: displayName });
  const mesh: JoinedMesh = {
    meshId: result.meshId, memberId: result.memberId, slug: result.slug,
    name: result.name, pubkey: kp.publicKey, secretKey: kp.secretKey,
    brokerUrl: result.brokerUrl || URLS.BROKER, joinedAt: new Date().toISOString(),
    rootKey: result.rootKey,
  };
  setMeshConfig(result.slug, mesh);
  return mesh;
}
