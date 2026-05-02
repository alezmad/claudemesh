/**
 * `claudemesh remind <message> --in <duration> | --at <time>`
 * `claudemesh remind list`
 * `claudemesh remind cancel <id>`
 *
 * Human-facing interface to the broker's scheduled message delivery.
 */

import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";

export interface RemindFlags {
  mesh?: string;
  in?: string;       // e.g. "2h", "30m", "90s"
  at?: string;       // ISO or HH:MM
  cron?: string;     // 5-field cron expression for recurring
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
    const hm = flags.at.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) {
      const now = new Date();
      const target = new Date(now);
      target.setHours(parseInt(hm[1]!, 10), parseInt(hm[2]!, 10), 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
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
  const action = positional[0];

  if (action === "list") {
    await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
      const scheduled = await client.listScheduled();
      if (flags.json) { console.log(JSON.stringify(scheduled, null, 2)); return; }
      if (scheduled.length === 0) { render.info(dim("No pending reminders.")); return; }
      render.section(`reminders (${scheduled.length})`);
      for (const m of scheduled) {
        const when = new Date(m.deliverAt).toLocaleString();
        const to = m.to === client.getSessionPubkey() ? dim("(self)") : m.to;
        process.stdout.write(`  ${bold(m.id.slice(0, 8))} ${dim("→")} ${to} ${dim("at")} ${when}\n`);
        process.stdout.write(`    ${dim(m.message.slice(0, 80))}\n\n`);
      }
    });
    return;
  }

  if (action === "cancel") {
    const id = positional[1];
    if (!id) { render.err("Usage: claudemesh remind cancel <id>"); process.exit(1); }
    await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
      const ok = await client.cancelScheduled(id);
      if (ok) render.ok(`cancelled ${bold(id.slice(0, 8))}`);
      else { render.err(`not found or already fired: ${id}`); process.exit(1); }
    });
    return;
  }

  const message = action ?? positional.join(" ");
  if (!message) {
    render.err("Usage: claudemesh remind <message> --in <duration>");
    render.info(dim("       claudemesh remind <message> --at <time>"));
    render.info(dim('       claudemesh remind <message> --cron "0 */2 * * *"'));
    render.info(dim("       claudemesh remind list"));
    render.info(dim("       claudemesh remind cancel <id>"));
    process.exit(1);
  }

  const isCron = !!flags.cron;
  const deliverAt = isCron ? 0 : parseDeliverAt(flags);
  if (!isCron && deliverAt === null) {
    render.err('Specify when', 'use --in <duration> (e.g. "2h", "30m"), --at <time> (e.g. "15:00"), or --cron <expression>');
    process.exit(1);
  }

  await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    let targetSpec: string;
    if (flags.to && flags.to !== "self") {
      if (flags.to.startsWith("@") || flags.to === "*" || /^[0-9a-f]{64}$/i.test(flags.to)) {
        targetSpec = flags.to;
      } else {
        const peers = await client.listPeers();
        const match = peers.find((p) => p.displayName.toLowerCase() === flags.to!.toLowerCase());
        if (!match) {
          render.err(`Peer "${flags.to}" not found`, `online: ${peers.map((p) => p.displayName).join(", ") || "(none)"}`);
          process.exit(1);
        }
        targetSpec = match.pubkey;
      }
    } else {
      targetSpec = client.getSessionPubkey() ?? "*";
    }

    const result = await client.scheduleMessage(targetSpec, message, deliverAt ?? 0, false, flags.cron);
    if (!result) { render.err("Broker did not acknowledge — check connection"); process.exit(1); }

    if (flags.json) { console.log(JSON.stringify(result)); return; }
    const toLabel = !flags.to || flags.to === "self" ? "yourself" : flags.to;
    if (isCron) {
      const nextFire = new Date(result.deliverAt).toLocaleString();
      render.ok(
        `recurring reminder set`,
        `${result.scheduledId.slice(0, 8)}  ·  ${clay(message)} → ${toLabel}  ·  cron ${flags.cron}  ·  next ${nextFire}`,
      );
    } else {
      const when = new Date(result.deliverAt).toLocaleString();
      render.ok(
        `reminder set`,
        `${result.scheduledId.slice(0, 8)}  ·  ${clay(message)} → ${toLabel} at ${when}`,
      );
    }
  });
}
