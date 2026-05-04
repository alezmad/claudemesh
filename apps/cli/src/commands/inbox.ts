/**
 * `claudemesh inbox` — read pending peer messages from the daemon's
 * persisted inbox (`~/.claudemesh/daemon/inbox.db`).
 *
 * 1.34.0: switched from the legacy cold-path "open fresh broker WS,
 * drain in-memory buffer" flow to a daemon IPC read against `/v1/inbox`.
 * The cold path was structurally broken — the persistent inbox lives in
 * the daemon, and pushes land on its session-WS, not on a freshly-opened
 * standalone WS. The daemon-route `tryListInboxViaDaemon` returns rows
 * persisted across daemon restarts and surfaces them with the correct
 * mesh scoping (server-side mesh filter added in 1.34.0).
 *
 * Cold-path fallback removed: when the daemon isn't reachable, the
 * prior implementation returned an empty list anyway (no broker state
 * = no buffered pushes), so removing that path doesn't lose any
 * functionality. Strict mode emits a clear error via daemon-route.
 */

import { tryListInboxViaDaemon } from "~/services/bridge/daemon-route.js";
import { render } from "~/ui/render.js";
import { bold, dim } from "~/ui/styles.js";

export interface InboxFlags {
  mesh?: string;
  json?: boolean;
  /** Cap the number of rows returned by the daemon. Default 100. */
  limit?: number;
  /** 1.34.8: only show rows whose seen_at is NULL (i.e., never
   *  surfaced via an interactive listing or live channel reminder).
   *  When omitted, every row is returned and an interactive listing
   *  stamps them seen as a side effect. */
  unread?: boolean;
}

interface FormattedItem {
  sender_pubkey: string;
  sender_name: string;
  body: string | null;
  topic: string | null;
  received_at: string;
  mesh: string;
}

function formatMessage(msg: FormattedItem, includeMesh: boolean): string {
  const text = msg.body ?? "[encrypted]";
  const from = msg.sender_name && msg.sender_name !== msg.sender_pubkey.slice(0, 8)
    ? `${msg.sender_name} (${msg.sender_pubkey.slice(0, 8)})`
    : msg.sender_pubkey.slice(0, 8);
  const time = new Date(msg.received_at).toLocaleTimeString();
  const topicTag = msg.topic ? ` (#${msg.topic})` : "";
  const meshTag = includeMesh ? ` [${msg.mesh}]` : "";
  return `  ${bold(from)} ${dim(`${meshTag}${topicTag} ${time}`)}\n  ${text}`;
}

export async function runInbox(flags: InboxFlags): Promise<void> {
  // Mesh resolution is owned by the daemon (it knows which meshes are
  // attached) — the CLI just forwards the user's --mesh flag through.
  // When omitted, the daemon's `/v1/inbox` honors the session-default
  // mesh on auth-token requests; out-of-session callers see rows from
  // every attached mesh. We don't pre-validate the mesh slug here so
  // the command works even from a launch tmpdir whose local
  // `config.json` only knows about the launch's mesh.
  const meshSlug = flags.mesh;

  const items = await tryListInboxViaDaemon(meshSlug, flags.limit ?? 100, {
    unreadOnly: flags.unread === true,
    // CLI is the canonical "I'm reading my inbox" path — let the daemon
    // auto-stamp seen_at on the rows we just rendered. The MCP welcome
    // path passes mark_seen=false instead and stamps explicitly after
    // the channel notification succeeds.
    markSeen: true,
  });
  if (items === null) {
    if (flags.json) { process.stdout.write("[]\n"); return; }
    render.info(dim("Daemon not reachable. Run `claudemesh daemon up` and retry."));
    return;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    return;
  }

  if (items.length === 0) {
    const scope = meshSlug ? `mesh "${meshSlug}"` : "any mesh";
    const filter = flags.unread ? "unread " : "";
    render.info(dim(`No ${filter}messages on ${scope}.`));
    return;
  }

  const filterTag = flags.unread ? " unread" : "";
  const heading = meshSlug
    ? `inbox — ${meshSlug} (${items.length}${filterTag} message${items.length === 1 ? "" : "s"})`
    : `inbox (${items.length}${filterTag} message${items.length === 1 ? "" : "s"})`;
  render.section(heading);
  // When the user didn't filter by mesh, surface the mesh slug per row
  // so they can tell apart rows from different meshes at a glance.
  for (const msg of items) {
    process.stdout.write(formatMessage(msg, !meshSlug) + "\n\n");
  }
}
