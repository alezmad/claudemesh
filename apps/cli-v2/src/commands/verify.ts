/**
 * `claudemesh verify [peer]` — show safety numbers for a peer.
 *
 * A safety number is a derived, human-readable fingerprint of the peer's
 * ed25519 public key plus your own. Both parties see the same digits,
 * so out-of-band comparison (call, in-person) detects MITM.
 *
 * Format: 6 groups of 5 decimal digits. Rendered from the first 15 bytes
 * of SHA-256(sorted(your_pubkey ++ peer_pubkey)). Matches the Signal /
 * Whatsapp pattern so users don't have to learn a new mental model.
 */

import { withMesh } from "./connect.js";
import { readConfig } from "~/services/config/facade.js";
import { EXIT } from "~/constants/exit-codes.js";
import { createHash } from "node:crypto";

function safetyNumber(myPubkey: string, peerPubkey: string): string {
  const a = Buffer.from(myPubkey, "hex");
  const b = Buffer.from(peerPubkey, "hex");
  const [lo, hi] = Buffer.compare(a, b) < 0 ? [a, b] : [b, a];
  const hash = createHash("sha256").update(lo).update(hi).digest();
  // Take first 15 bytes, split into 6 groups of 20 bits → 5 decimal digits each.
  const bits: number[] = [];
  for (let i = 0; i < 15; i++) {
    for (let b = 7; b >= 0; b--) {
      bits.push((hash[i]! >> b) & 1);
    }
  }
  const groups: string[] = [];
  for (let g = 0; g < 6; g++) {
    let val = 0;
    for (let i = 0; i < 20; i++) val = val * 2 + bits[g * 20 + i]!;
    groups.push(String(val % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
}

export async function runVerify(
  target: string | undefined,
  opts: { mesh?: string; json?: boolean } = {},
): Promise<number> {
  const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const clay = (s: string) => (useColor ? `\x1b[38;2;217;119;87m${s}\x1b[39m` : s);

  const config = readConfig();
  const meshSlug = opts.mesh ?? config.meshes[0]?.slug;
  if (!meshSlug) {
    console.error("  No meshes joined. Run `claudemesh join <url>` first.");
    return EXIT.NOT_FOUND;
  }
  const mesh = config.meshes.find((m) => m.slug === meshSlug);
  if (!mesh) {
    console.error(`  Mesh "${meshSlug}" not found locally.`);
    return EXIT.NOT_FOUND;
  }

  return await withMesh({ meshSlug }, async (client) => {
    const peers = await client.listPeers();
    const targets = target
      ? peers.filter((p) => p.displayName === target || p.pubkey === target || p.pubkey.startsWith(target))
      : peers;
    if (targets.length === 0) {
      console.error(`  No peer matching "${target ?? "(all)"}" on mesh ${meshSlug}.`);
      return EXIT.NOT_FOUND;
    }

    if (opts.json) {
      console.log(JSON.stringify(targets.map((p) => ({
        mesh: meshSlug,
        peer: p.displayName,
        pubkey: p.pubkey,
        safetyNumber: safetyNumber(mesh.pubkey, p.pubkey),
      })), null, 2));
      return EXIT.SUCCESS;
    }

    console.log("");
    console.log(`  ${dim("— safety numbers on")} ${bold(meshSlug)}`);
    console.log("");
    for (const p of targets) {
      const sn = safetyNumber(mesh.pubkey, p.pubkey);
      console.log(`  ${bold(p.displayName)}`);
      console.log(`  ${clay(sn)}`);
      console.log(`  ${dim(`pubkey ${p.pubkey.slice(0, 16)}…`)}`);
      console.log("");
    }
    console.log(dim("  Compare these digits with your peer (phone, in person, not chat)."));
    console.log(dim("  If they match on both sides, the channel is not being intercepted."));
    console.log("");
    return EXIT.SUCCESS;
  });
}
