import type { PeerInfo } from "~/services/broker/facade.js";
import { bold, dim, green, yellow, red } from "~/ui/styles.js";
const S: Record<string, (s: string) => string> = { idle: green, working: yellow, dnd: red };
export function renderPeers(peers: PeerInfo[], meshSlug: string): string {
  if (peers.length === 0) return "  No peers online in " + meshSlug + ".";
  return peers.map(p => {
    const icon = (S[p.status] ?? dim)("\u25CF");
    const summary = p.summary ? dim(" \u2014 " + p.summary) : "";
    return "  " + icon + " " + bold(p.displayName) + summary;
  }).join("\n");
}
