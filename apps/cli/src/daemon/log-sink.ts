/**
 * Rotating log sink for the daemon (1.37.1).
 *
 * Why this exists: the daemon writes JSON lines to `process.stdout` /
 * `process.stderr` from ~20 call sites, and under launchd / systemd those
 * streams were redirected straight into `~/.claudemesh/daemon/daemon.log`
 * by the service unit (`StandardOutPath`). launchd does not rotate — the
 * 2026-09-08 incident found a 1.0 GB `daemon.log` (disk at 95 %), most
 * plausibly the reason the daemon died silently.
 *
 * The sink takes ownership of both streams in-process: every write is
 * appended synchronously to `path` through our own fd, and the file is
 * rotated when it reaches `maxBytes` (`path.1` … `path.<keep>`, oldest
 * deleted). A total-size budget (`keep × maxBytes`) is enforced across
 * the rotated archives so a pre-existing oversized file cannot pin the
 * disk after upgrade.
 *
 * Failure policy: a throw anywhere inside the sink must NEVER take the
 * daemon down. On any error the sink falls back to the original
 * `write` for that call (which goes wherever launchd pointed stdio —
 * `daemon.launchd.log` on 1.37.1+ units, the old path on stale units).
 *
 * Spec: .artifacts/specs/2026-09-08-daemon-restart-mesh-blackout.md,
 * Addendum 5 item 9.
 */

import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export interface LogSinkOptions {
  /** Active log file (e.g. DAEMON_PATHS.LOG_FILE). */
  path: string;
  /** Rotate when the active file reaches this size. Default 20 MB. */
  maxBytes?: number;
  /** Rotated archives to keep (`path.1` … `path.keep`). Default 5. */
  keep?: number;
  /** Also mirror lines to the original stdout/stderr (dev use). Default false. */
  tee?: boolean;
}

export interface LogSinkHandle {
  /** Append one line (a trailing newline is added when missing). */
  writeLine(line: string): void;
  /** Force a rotation now (used by tests + `daemon rotate-log`). */
  rotateNow(): void;
  /** Bytes currently in the active file (0 when unknown). */
  currentSize(): number;
  /** Restore the original process.stdout/stderr writes and close the fd. */
  uninstall(): void;
  readonly path: string;
}

export const DEFAULT_LOG_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_LOG_KEEP = 5;

type WriteFn = typeof process.stdout.write;

/**
 * Rotate `path` → `path.1`, shifting existing archives up by one and
 * deleting anything beyond `keep`. Pure filesystem operation; safe to
 * call when `path` does not exist (no-op).
 */
export function rotateLogFiles(path: string, keep: number): void {
  if (!existsSync(path)) return;
  // Drop the oldest slot if occupied.
  const oldest = `${path}.${keep}`;
  if (existsSync(oldest)) { try { unlinkSync(oldest); } catch { /* ignore */ } }
  for (let n = keep - 1; n >= 1; n--) {
    const from = `${path}.${n}`;
    if (existsSync(from)) { try { renameSync(from, `${path}.${n + 1}`); } catch { /* ignore */ } }
  }
  renameSync(path, `${path}.1`);
}

/** Size of a file in bytes, 0 when missing/unreadable. */
function sizeOf(p: string): number {
  try { return statSync(p).size; } catch { return 0; }
}

/**
 * Enforce the archive budget: while the total size of `path.1..path.keep`
 * exceeds `keep × maxBytes`, delete the OLDEST archive (highest index)
 * first. Returns the list of deleted paths.
 *
 * This is what shrinks a 1 GB pre-1.37.1 log after upgrade: the install
 * step rotates it to `path.1`, and since `path.1` alone exceeds the whole
 * budget it is deleted right away. Evidence worth keeping must be
 * extracted BEFORE upgrade (the 2026-09-08 excerpts live in
 * `.artifacts/test-runs/`).
 */
export function purgeArchivesOverBudget(path: string, keep: number, maxBytes: number): string[] {
  const deleted: string[] = [];
  const budget = keep * maxBytes;
  const total = () => {
    let t = 0;
    for (let n = 1; n <= keep; n++) t += sizeOf(`${path}.${n}`);
    return t;
  };
  for (let n = keep; n >= 1 && total() > budget; n--) {
    const p = `${path}.${n}`;
    if (!existsSync(p)) continue;
    try { unlinkSync(p); deleted.push(p); } catch { /* ignore */ }
  }
  return deleted;
}

/**
 * Take over process.stdout/stderr and route every write into a rotating
 * file. Returns a handle; call `uninstall()` to restore the originals.
 */
export function installRotatingLogSink(opts: LogSinkOptions): LogSinkHandle {
  const path = opts.path;
  const maxBytes = opts.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const keep = Math.max(1, opts.keep ?? DEFAULT_LOG_KEEP);
  const tee = !!opts.tee;

  const origOut: WriteFn = process.stdout.write.bind(process.stdout) as WriteFn;
  const origErr: WriteFn = process.stderr.write.bind(process.stderr) as WriteFn;

  let fd: number | null = null;
  let size = 0;
  let installed = false;
  let inSink = false; // re-entrancy guard (a throw → fallback write must not recurse)

  const open = (): void => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fd = openSync(path, "a", 0o600);
    try { size = fstatSync(fd).size; } catch { size = 0; }
  };

  const closeFd = (): void => {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } fd = null; }
  };

  const rotate = (): void => {
    closeFd();
    rotateLogFiles(path, keep);
    purgeArchivesOverBudget(path, keep, maxBytes);
    open();
  };

  // Install-time hygiene: an oversized existing file (pre-1.37.1 launchd
  // log) is rotated immediately so the active file starts small, then
  // the archive budget is enforced.
  if (sizeOf(path) >= maxBytes) {
    try { rotateLogFiles(path, keep); } catch { /* ignore */ }
  }
  try { purgeArchivesOverBudget(path, keep, maxBytes); } catch { /* ignore */ }
  open();

  const append = (chunk: string | Uint8Array): boolean => {
    if (fd === null) return false;
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    if (size + buf.length >= maxBytes && size > 0) rotate();
    let off = 0;
    while (off < buf.length) {
      off += writeSync(fd!, buf, off, buf.length - off);
    }
    size += buf.length;
    return true;
  };

  const makeWrite = (orig: WriteFn): WriteFn => {
    const w = function (this: unknown, chunk: any, encodingOrCb?: any, cb?: any): boolean {
      const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
      if (!inSink) {
        inSink = true;
        try {
          const str = typeof chunk === "string"
            ? chunk
            : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
              ? Buffer.from(chunk).toString(typeof encodingOrCb === "string" ? (encodingOrCb as BufferEncoding) : "utf8")
              : String(chunk);
          const ok = append(str);
          inSink = false;
          if (ok) {
            if (tee) { try { orig(str); } catch { /* ignore */ } }
            if (typeof callback === "function") { try { callback(); } catch { /* ignore */ } }
            return true;
          }
        } catch {
          inSink = false;
          // fall through to the original write below
        }
      }
      // Fallback: original stream (launchd/systemd redirect target).
      try { return orig(chunk, encodingOrCb, cb); } catch { return false; }
    };
    return w as unknown as WriteFn;
  };

  const sinkOut = makeWrite(origOut);
  const sinkErr = makeWrite(origErr);
  (process.stdout as { write: WriteFn }).write = sinkOut;
  (process.stderr as { write: WriteFn }).write = sinkErr;
  installed = true;

  return {
    path,
    writeLine(line: string) {
      const l = line.endsWith("\n") ? line : line + "\n";
      try { if (!append(l)) origErr(l); } catch { try { origErr(l); } catch { /* ignore */ } }
    },
    rotateNow() {
      try { rotate(); } catch { /* ignore */ }
    },
    currentSize() { return size; },
    uninstall() {
      if (!installed) return;
      installed = false;
      (process.stdout as { write: WriteFn }).write = origOut;
      (process.stderr as { write: WriteFn }).write = origErr;
      closeFd();
    },
  };
}
