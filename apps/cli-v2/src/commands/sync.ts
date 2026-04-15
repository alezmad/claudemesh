/**
 * `claudemesh sync` — re-sync meshes from dashboard account.
 *
 * Opens browser for OAuth, receives sync token, calls broker /cli-sync,
 * merges new meshes into local config.
 */

import { createInterface } from "node:readline";
import { hostname } from "node:os";
import { readConfig, writeConfig } from "~/services/config/facade.js";
import { startCallbackListener, generatePairingCode, syncWithBroker } from "~/services/auth/facade.js";
import { openBrowser } from "~/services/spawn/facade.js";
import { generateKeypair } from "~/services/crypto/facade.js";

export async function runSync(args: { force?: boolean }): Promise<void> {
  const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const green = (s: string): string => (useColor ? `\x1b[32m${s}\x1b[39m` : s);

  const config = readConfig();

  const code = generatePairingCode();
  const listener = await startCallbackListener();
  const url = `https://claudemesh.com/cli-auth?port=${listener.port}&code=${code}&action=sync`;

  console.log(`Opening browser to sync meshes...`);
  console.log(dim(`Visit: ${url}`));
  await openBrowser(url);

  // Race: localhost callback vs manual paste vs timeout
  const manualPromise = new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Paste sync token (or wait for browser): ", (answer) => {
      rl.close();
      if (answer.trim()) resolve(answer.trim());
    });
  });

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), 15 * 60_000);
  });

  const syncToken = await Promise.race([
    listener.token,
    manualPromise,
    timeoutPromise,
  ]);

  listener.close();

  if (!syncToken) {
    console.error("Timed out waiting for sign-in.");
    process.exit(1);
  }

  // Use existing keypair from first mesh, or generate new
  const keypair = config.meshes.length > 0
    ? { publicKey: config.meshes[0]!.pubkey, secretKey: config.meshes[0]!.secretKey }
    : await generateKeypair();

  const displayName = config.displayName ?? `${hostname()}-${process.pid}`;

  const result = await syncWithBroker(syncToken, keypair.publicKey, displayName);

  // Merge: add new meshes, skip duplicates
  let added = 0;
  for (const m of result.meshes) {
    if (config.meshes.some(existing => existing.meshId === m.mesh_id)) continue;
    config.meshes.push({
      meshId: m.mesh_id,
      memberId: m.member_id,
      slug: m.slug,
      name: m.slug,
      pubkey: keypair.publicKey,
      secretKey: keypair.secretKey,
      brokerUrl: m.broker_url,
      joinedAt: new Date().toISOString(),
    });
    added++;
  }
  config.accountId = result.account_id;
  writeConfig(config);

  if (added > 0) {
    console.log(green(`✓ Added ${added} new mesh(es)`));
  } else {
    console.log(`Already up to date (${config.meshes.length} meshes)`);
  }
}
