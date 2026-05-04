/**
 * `claudemesh inbox flush` and `claudemesh inbox delete <id>` —
 * mutate the daemon's persistent inbox store
 * (`~/.claudemesh/daemon/inbox.db`) over IPC.
 *
 * 1.34.7: until this version, the only way to clean the inbox was a
 * raw `sqlite3 inbox.db "DELETE FROM inbox"` against the daemon's
 * private DB. That works but bypasses the IPC layer (and any future
 * lifecycle hooks on row removal), and is invisible to a user who
 * doesn't know the schema. These two verbs make the operation visible
 * + safe + scriptable.
 */

import {
  tryFlushInboxViaDaemon,
  tryDeleteInboxRowViaDaemon,
} from "~/services/bridge/daemon-route.js";
import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";

export interface InboxFlushFlags {
  mesh?: string;
  /** ISO-8601 timestamp; deletes rows received_at < before. */
  before?: string;
  /** Required when neither --mesh nor --before is set, to prevent an
   *  accidental "delete every row on every mesh". */
  all?: boolean;
  json?: boolean;
}

export async function runInboxFlush(flags: InboxFlushFlags): Promise<void> {
  const hasFilter = !!(flags.mesh || flags.before);
  if (!hasFilter && !flags.all) {
    if (flags.json) { process.stdout.write(JSON.stringify({ ok: false, error: "missing_filter" }) + "\n"); return; }
    render.info(dim(
      "Refusing to flush every row on every mesh.\n" +
      "  Re-run with --mesh <slug>, --before <iso-timestamp>, or --all to confirm.",
    ));
    process.exit(1);
  }

  const removed = await tryFlushInboxViaDaemon({
    ...(flags.mesh ? { mesh: flags.mesh } : {}),
    ...(flags.before ? { beforeIso: flags.before } : {}),
  });

  if (removed === null) {
    if (flags.json) { process.stdout.write(JSON.stringify({ ok: false, error: "daemon_unreachable" }) + "\n"); return; }
    render.info(dim("Daemon not reachable. Run `claudemesh daemon up` and retry."));
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, removed }) + "\n");
    return;
  }
  const scope = flags.mesh
    ? `mesh "${flags.mesh}"`
    : flags.before
      ? `older than ${flags.before}`
      : "all meshes";
  render.info(`✔ Flushed ${removed} message${removed === 1 ? "" : "s"} from ${scope}.`);
}

export interface InboxDeleteFlags {
  json?: boolean;
}

export async function runInboxDelete(id: string, flags: InboxDeleteFlags): Promise<void> {
  if (!id) {
    if (flags.json) { process.stdout.write(JSON.stringify({ ok: false, error: "missing_id" }) + "\n"); return; }
    render.info(dim("Usage: claudemesh inbox delete <message-id>"));
    process.exit(1);
  }
  const ok = await tryDeleteInboxRowViaDaemon(id);
  if (ok === null) {
    if (flags.json) { process.stdout.write(JSON.stringify({ ok: false, error: "daemon_unreachable" }) + "\n"); return; }
    render.info(dim("Daemon not reachable. Run `claudemesh daemon up` and retry."));
    process.exit(1);
  }
  if (!ok) {
    if (flags.json) { process.stdout.write(JSON.stringify({ ok: false, error: "not_found", id }) + "\n"); return; }
    render.info(dim(`No inbox row with id "${id}".`));
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, id }) + "\n");
    return;
  }
  render.info(`✔ Deleted inbox row ${id}.`);
}
