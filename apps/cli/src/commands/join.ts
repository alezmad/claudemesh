/**
 * `claudemesh join <invite-link-or-code>` — full join flow.
 *
 * Accepts either:
 *   - v2 short invite: `claudemesh.com/i/<code>` or bare `<code>`
 *     → POSTs to /api/public/invites/:code/claim, unseals root_key,
 *       persists mesh + fresh ed25519 identity.
 *   - v1 legacy invite: `ic://join/<token>` or `https://.../join/<token>`
 *     → parses signed payload, calls broker /join, persists.
 *
 * v1 continues to work throughout v0.1.x. v1 endpoints 410 Gone at v0.2.0.
 */

import { parseInviteLink } from "~/services/invite/facade.js";
import { enrollWithBroker } from "~/services/invite/facade.js";
import { generateKeypair } from "~/services/crypto/facade.js";
import { readConfig, writeConfig, getConfigPath } from "~/services/config/facade.js";
import { claimInviteV2, parseV2InviteInput } from "~/services/invite/facade.js";
import sodium from "libsodium-wrappers";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, hostname } from "node:os";
import { env } from "~/constants/urls.js";

/** Derive the web app base URL from the broker URL, unless explicitly overridden. */
function deriveAppBaseUrl(): string {
  const override = process.env.CLAUDEMESH_APP_URL;
  if (override) return override.replace(/\/$/, "");
  // Broker is `wss://ic.claudemesh.com/ws` → app is `https://claudemesh.com`.
  // For self-hosted: honour the broker host's parent domain as best-effort.
  try {
    const u = new URL(env.CLAUDEMESH_BROKER_URL);
    const host = u.host.replace(/^ic\./, "");
    const scheme = u.protocol === "wss:" ? "https:" : "http:";
    return `${scheme}//${host}`;
  } catch {
    return "https://claudemesh.com";
  }
}

async function runJoinV2(code: string): Promise<void> {
  const appBaseUrl = deriveAppBaseUrl();
  console.log(`Claiming invite ${code} via ${appBaseUrl}…`);

  let claim;
  try {
    claim = await claimInviteV2({ appBaseUrl, code });
  } catch (e) {
    console.error(
      `claudemesh: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }

  // Generate a fresh ed25519 identity for this peer. The v2 claim
  // endpoint creates the member row keyed on the x25519 pubkey we sent;
  // the ed25519 keypair is what the `hello` handshake and future
  // envelope signing will use. Stored locally only.
  const keypair = await generateKeypair();
  const displayName = `${hostname()}-${process.pid}`;

  // Encode the unsealed 32-byte root key as URL-safe base64url (no pad)
  // to match the format used everywhere else (broker stores it the
  // same way in mesh.rootKey).
  await sodium.ready;
  const rootKeyB64 = sodium.to_base64(
    claim.rootKey,
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );

  // Persist. We don't have a mesh_slug in the v2 response — the server
  // derives slug from name and slug is no longer globally unique. Use a
  // stable short derivative of the mesh id so `list` / `launch --mesh`
  // still have something to match on.
  const fallbackSlug = `mesh-${claim.meshId.slice(0, 8)}`;
  const config = readConfig();
  config.meshes = config.meshes.filter((m) => m.meshId !== claim.meshId);
  config.meshes.push({
    meshId: claim.meshId,
    memberId: claim.memberId,
    slug: fallbackSlug,
    name: fallbackSlug,
    pubkey: keypair.publicKey,
    secretKey: keypair.secretKey,
    brokerUrl: env.CLAUDEMESH_BROKER_URL,
    joinedAt: new Date().toISOString(),
    rootKey: rootKeyB64,
    inviteVersion: 2,
  });
  writeConfig(config);

  console.log("");
  console.log(`✓ Joined mesh ${claim.meshId} via v2 invite`);
  console.log(`  member id:  ${claim.memberId}`);
  console.log(`  pubkey:     ${keypair.publicKey.slice(0, 16)}…`);
  console.log(`  broker:     ${env.CLAUDEMESH_BROKER_URL}`);
  console.log(`  config:     ${getConfigPath()}`);
  console.log("");
  console.log("Restart Claude Code to pick up the new mesh.");
}

export async function runJoin(args: string[]): Promise<void> {
  const link = args[0];
  if (!link) {
    console.error("Usage: claudemesh join <invite-url-or-code>");
    console.error("");
    console.error("Examples:");
    console.error("  claudemesh join https://claudemesh.com/i/abc12345");
    console.error("  claudemesh join abc12345");
    console.error("  claudemesh join ic://join/eyJ2IjoxLC4uLn0   (v1 legacy)");
    process.exit(1);
  }

  // Try v2 first — short code / `/i/<code>` URL.
  const v2Code = parseV2InviteInput(link);
  if (v2Code) {
    await runJoinV2(v2Code);
    return;
  }

  // 1. Parse + verify signature client-side.
  let invite;
  try {
    invite = await parseInviteLink(link);
  } catch (e) {
    console.error(
      `claudemesh: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
  const { payload, token } = invite;
  console.log(`Joining mesh "${payload.mesh_slug}" (${payload.mesh_id})…`);

  // 2. Generate keypair.
  const keypair = await generateKeypair();

  // 3. Enroll with broker.
  const displayName = `${hostname()}-${process.pid}`;
  let enroll;
  try {
    enroll = await enrollWithBroker({
      brokerWsUrl: payload.broker_url,
      inviteToken: token,
      invitePayload: payload,
      peerPubkey: keypair.publicKey,
      displayName,
    });
  } catch (e) {
    console.error(
      `claudemesh: broker enrollment failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }

  // 4. Persist.
  const config = readConfig();
  config.meshes = config.meshes.filter(
    (m) => m.slug !== payload.mesh_slug,
  );
  config.meshes.push({
    meshId: payload.mesh_id,
    memberId: enroll.memberId,
    slug: payload.mesh_slug,
    name: payload.mesh_slug,
    pubkey: keypair.publicKey,
    secretKey: keypair.secretKey,
    brokerUrl: payload.broker_url,
    joinedAt: new Date().toISOString(),
  });
  writeConfig(config);

  // 4b. Store invite token for per-session re-enrollment (launch --name).
  const configDir = env.CLAUDEMESH_CONFIG_DIR ?? join(homedir(), ".claudemesh");
  const inviteFile = join(configDir, `invite-${payload.mesh_slug}.txt`);
  try {
    mkdirSync(dirname(inviteFile), { recursive: true });
    writeFileSync(inviteFile, link, "utf-8");
  } catch {
    // Non-fatal — launch will fall back to shared identity.
  }

  // 5. Report.
  console.log("");
  console.log(
    `✓ Joined "${payload.mesh_slug}" as ${displayName}${enroll.alreadyMember ? " (already a member — re-enrolled with same pubkey)" : ""}`,
  );
  console.log(`  member id: ${enroll.memberId}`);
  console.log(`  pubkey:    ${keypair.publicKey.slice(0, 16)}…`);
  console.log(`  broker:    ${payload.broker_url}`);
  console.log(`  config:    ${getConfigPath()}`);
  console.log("");
  console.log("Restart Claude Code to pick up the new mesh.");
}
