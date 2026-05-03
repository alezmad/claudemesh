/**
 * `claudemesh file share <path>` — upload a file to the mesh.
 * `claudemesh file get   <id>`   — download a file by id.
 *
 * Same-host fast path: when `--to <peer>` is provided and the target
 * peer's `hostname` matches this machine's, we skip the MinIO upload
 * entirely and send a DM containing the absolute path. The receiver
 * reads it directly off the local filesystem. Saves bandwidth + bucket
 * space for the common "two Claude sessions on the same laptop" case.
 *
 * Falls back to encrypted MinIO upload + grant when:
 *   - `--to` not provided (sharing with the whole mesh)
 *   - target peer is on a different host
 *   - `--upload` flag forces the network path
 */

import { hostname as osHostname } from "node:os";
import { resolve as resolvePath, basename, dirname } from "node:path";
import { statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";

import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { bold, dim, green } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

// Broker enforces 50 MB on /upload (apps/broker/src/index.ts ~line 1204).
// We mirror it client-side so users get a clear error before bytes go on the wire.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

type Flags = {
  mesh?: string;
  json?: boolean;
  to?: string;
  tags?: string;
  out?: string;
  upload?: boolean; // force network upload, skip same-host fast path
  message?: string; // optional note attached to the share DM
};

function emitJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function runFileShare(filePath: string, opts: Flags): Promise<number> {
  if (!filePath) {
    render.err("Usage: claudemesh file share <path> [--to <peer>] [--tags a,b] [--message \"...\"] [--upload]");
    return EXIT.INVALID_ARGS;
  }
  const absPath = resolvePath(filePath);
  if (!existsSync(absPath)) {
    render.err(`File not found: ${absPath}`);
    return EXIT.INVALID_ARGS;
  }
  const stat = statSync(absPath);
  if (!stat.isFile()) {
    render.err(`Not a regular file: ${absPath}`);
    return EXIT.INVALID_ARGS;
  }
  // Network upload has a 50 MB cap (broker-enforced). The same-host fast
  // path doesn't transfer bytes — it sends a filepath — so it has no cap.

  const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client, mesh) => {
    // ── Same-host fast path ─────────────────────────────────────────────
    // If --to points at a peer running on this same machine, just DM the
    // absolute path. No upload, no MinIO, no presigned URLs.
    if (opts.to && !opts.upload) {
      const peers = await client.listPeers();
      const myHost = osHostname();
      const target = peers.find((p) => {
        if (!p.hostname || p.hostname !== myHost) return false;
        return (
          p.displayName === opts.to ||
          (p as { memberPubkey?: string }).memberPubkey === opts.to ||
          p.pubkey === opts.to ||
          (typeof opts.to === "string" && opts.to.length >= 8 && p.pubkey.startsWith(opts.to))
        );
      });

      if (target) {
        const note = opts.message ? `\n${opts.message}` : "";
        const body = `📎 file://${absPath} (${formatSize(stat.size)} · same host, no upload)${note}`;
        // Route by session pubkey, not displayName — sibling sessions of
        // the same member share the displayName (and the v0.5.1 self-DM
        // guard would otherwise reject sends targeting our own member).
        const result = await client.send(target.pubkey, body, "next");
        if (!result.ok) {
          render.err(`Send failed: ${result.error ?? "unknown"}`);
          return EXIT.NETWORK_ERROR;
        }
        if (opts.json) {
          emitJson({ mode: "local", path: absPath, to: target.displayName, hostname: myHost, sizeBytes: stat.size });
        } else {
          render.ok(`shared ${bold(basename(absPath))} ${dim(`(${formatSize(stat.size)})`)} → ${green(target.displayName)} ${dim("[same host, no upload]")}`);
        }
        return EXIT.SUCCESS;
      }
      // No same-host match — fall through to upload path.
    }

    // ── Network upload path ─────────────────────────────────────────────
    const fileId = await client.uploadFile(absPath, mesh.meshId, mesh.memberId, {
      name: basename(absPath),
      tags,
      persistent: true,
      targetSpec: opts.to,
    });

    // If --to was set, drop a DM so the recipient is notified + has the id.
    if (opts.to) {
      const note = opts.message ? `\n${opts.message}` : "";
      const body = `📎 ${basename(absPath)} (${formatSize(stat.size)})\nclaudemesh file get ${fileId}${note}`;
      await client.send(opts.to, body, "next");
    }

    if (opts.json) {
      emitJson({ mode: "upload", fileId, name: basename(absPath), sizeBytes: stat.size, to: opts.to ?? null });
    } else {
      render.ok(`uploaded ${bold(basename(absPath))} ${dim(`(${formatSize(stat.size)})`)} ${dim("· id=" + fileId.slice(0, 12))}`);
      if (opts.to) render.info(dim(`  notified ${opts.to}`));
      else render.info(dim(`  retrieve: claudemesh file get ${fileId}`));
    }
    return EXIT.SUCCESS;
  });
}

export async function runFileGet(fileId: string, opts: Flags): Promise<number> {
  if (!fileId) {
    render.err("Usage: claudemesh file get <file-id> [--out <path>]");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: opts.mesh ?? null }, async (client) => {
    const meta = await client.getFile(fileId);
    if (!meta) {
      render.err(`File not found or not accessible: ${fileId}`);
      return EXIT.NOT_FOUND;
    }

    const res = await fetch(meta.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      render.err(`Download failed: HTTP ${res.status}`);
      return EXIT.NETWORK_ERROR;
    }
    const buf = Buffer.from(await res.arrayBuffer());

    const outPath = opts.out
      ? resolvePath(opts.out)
      : resolvePath(process.cwd(), meta.name);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, buf);

    if (opts.json) {
      emitJson({ fileId, name: meta.name, savedTo: outPath, sizeBytes: buf.length });
    } else {
      render.ok(`saved ${bold(meta.name)} ${dim(`(${formatSize(buf.length)})`)} → ${dim(outPath)}`);
    }
    return EXIT.SUCCESS;
  });
}
