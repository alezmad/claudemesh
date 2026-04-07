/**
 * `claudemesh remind <message> --in <duration> | --at <time>`
 * `claudemesh remind list`
 * `claudemesh remind cancel <id>`
 *
 * Human-facing interface to the broker's scheduled message delivery.
 */

import { withMesh } from "./connect";

export interface RemindFlags {
  mesh?: string;
  in?: string;       // e.g. "2h", "30m", "90s"
  at?: string;       // ISO or HH:MM
  to?: string;       // default: self
  json?: boolean;
}

function parseDuration(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  const unit = (m[2] ?? "s").toLowerCase();
  if (unit.startsWith("d")) return n * 86_400_000;
  if (unit.startsWith("h")) return n * 3_600_000;
  if (unit.startsWith("m")) return n * 60_000;
  return n * 1_000;
}

function parseDeliverAt(flags: RemindFlags): number | null {
  if (flags.in) {
    const ms = parseDuration(flags.in);
    if (ms === null) return null;
    return Date.now() + ms;
  }
  if (flags.at) {
    // Try HH:MM first
    const hm = flags.at.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) {
      const now = new Date();
      const target = new Date(now);
      target.setHours(parseInt(hm[1]!, 10), parseInt(hm[2]!, 10), 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1); // next occurrence
      return target.getTime();
    }
    const ts = Date.parse(flags.at);
    return isNaN(ts) ? null : ts;
  }
  return null;
}

export async function runRemind(
  flags: RemindFlags,
  positional: string[],
): Promise<void> {
  const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);

  const action = positional[0];

  // claudemesh remind list
  if (action === "list") {
    await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
      const scheduled = await client.listScheduled();
      if (flags.json) { console.log(JSON.stringify(scheduled, null, 2)); return; }
      if (scheduled.length === 0) { console.log(dim("No pending reminders.")); return; }
      for (const m of scheduled) {
        const when = new Date(m.deliverAt).toLocaleString();
        const to = m.to === client.getSessionPubkey() ? dim("(self)") : m.to;
        console.log(`  ${bold(m.id.slice(0, 8))} → ${to} at ${when}`);
        console.log(`  ${dim(m.message.slice(0, 80))}`);
        console.log("");
      }
    });
    return;
  }

  // claudemesh remind cancel <id>
  if (action === "cancel") {
    const id = positional[1];
    if (!id) { console.error("Usage: claudemesh remind cancel <id>"); process.exit(1); }
    await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
      const ok = await client.cancelScheduled(id);
      if (ok) console.log(`✓ Cancelled ${id}`);
      else { console.error(`✗ Not found or already fired: ${id}`); process.exit(1); }
    });
    return;
  }

  // claudemesh remind <message> --in <duration> | --at <time>
  const message = action ?? positional.join(" ");
  if (!message) {
    console.error("Usage: claudemesh remind <message> --in <duration>");
    console.error("       claudemesh remind <message> --at <time>");
    console.error("       claudemesh remind list");
    console.error("       claudemesh remind cancel <id>");
    process.exit(1);
  }

  const deliverAt = parseDeliverAt(flags);
  if (deliverAt === null) {
    console.error('Specify when: --in <duration> (e.g. "2h", "30m") or --at <time> (e.g. "15:00")');
    process.exit(1);
  }

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    // Determine target: --to flag or self
    let targetSpec: string;
    if (flags.to && flags.to !== "self") {
      if (flags.to.startsWith("@") || flags.to === "*" || /^[0-9a-f]{64}$/i.test(flags.to)) {
        targetSpec = flags.to;
      } else {
        const peers = await client.listPeers();
        const match = peers.find((p) => p.displayName.toLowerCase() === flags.to!.toLowerCase());
        if (!match) {
          console.error(`Peer "${flags.to}" not found. Online: ${peers.map((p) => p.displayName).join(", ") || "(none)"}`);
          process.exit(1);
        }
        targetSpec = match.pubkey;
      }
    } else {
      targetSpec = client.getSessionPubkey() ?? "*";
    }

    const result = await client.scheduleMessage(targetSpec, message, deliverAt);
    if (!result) { console.error("✗ Broker did not acknowledge — check connection"); process.exit(1); }

    if (flags.json) { console.log(JSON.stringify(result)); return; }
    const when = new Date(result.deliverAt).toLocaleString();
    const toLabel = !flags.to || flags.to === "self" ? "yourself" : flags.to;
    console.log(`✓ Reminder set (${result.scheduledId.slice(0, 8)}): "${message}" → ${toLabel} at ${when}`);
  });
}
