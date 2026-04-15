/**
 * Unified renderer — every command emits its output through this module
 * so the palette, spacing, and icons stay consistent across the CLI.
 *
 * Design: narrow API (ok / warn / err / info / section / kv / code / link)
 * over a single source of styles. No rogue `console.log` color codes.
 * Matches the web's claudemesh brand: clay accent (#d97757 → xterm 173),
 * dim gray for meta, serif-less mono for kv tables.
 */

import { clay, dim, bold, green, red, yellow, cyan, icons } from "./styles.js";

const OUT = process.stdout;
const ERR = process.stderr;

/** Leading 2-space indent is the house style — matches share/invite output. */
const INDENT = "  ";

export const render = {
  blank(): void {
    OUT.write("\n");
  },

  ok(msg: string, detail?: string): void {
    const d = detail ? ` ${dim("(" + detail + ")")}` : "";
    OUT.write(`${INDENT}${green(icons.check)} ${msg}${d}\n`);
  },

  warn(msg: string, hint?: string): void {
    OUT.write(`${INDENT}${yellow(icons.warn)} ${msg}\n`);
    if (hint) OUT.write(`${INDENT}  ${dim(hint)}\n`);
  },

  err(msg: string, hint?: string): void {
    ERR.write(`${INDENT}${red(icons.cross)} ${msg}\n`);
    if (hint) ERR.write(`${INDENT}  ${dim(hint)}\n`);
  },

  info(msg: string): void {
    OUT.write(`${INDENT}${msg}\n`);
  },

  /** Brand-colored section header with em-dash eyebrow. */
  section(title: string): void {
    OUT.write(`\n${INDENT}${dim("—")} ${clay(title)}\n\n`);
  },

  /** Labelled heading in bold. Use when you want a weight break. */
  heading(title: string): void {
    OUT.write(`${INDENT}${bold(title)}\n`);
  },

  /** Key/value pair — keys right-padded to align. */
  kv(pairs: Array<[label: string, value: string]>, opts?: { padTo?: number }): void {
    const pad = opts?.padTo ?? Math.max(...pairs.map(([k]) => k.length)) + 2;
    for (const [k, v] of pairs) {
      OUT.write(`${INDENT}${dim(k.padEnd(pad, " "))}${v}\n`);
    }
  },

  /** Code block (dim background by default terminal), 4-space indent. */
  code(snippet: string): void {
    for (const line of snippet.split("\n")) {
      OUT.write(`${INDENT}  ${cyan(line)}\n`);
    }
  },

  /** Clickable link in modern terminals (OSC 8). Falls back to plain URL. */
  link(url: string): void {
    OUT.write(`${INDENT}${clay(url)}\n`);
  },

  /** Hint line — dim + leading arrow. Used after a failure for remediation. */
  hint(msg: string): void {
    OUT.write(`${INDENT}${dim(icons.arrow + " " + msg)}\n`);
  },
};

/** Return JSON suitable for `--json` flags. Zero styling, schema-versioned. */
export function jsonOut<T>(payload: T, schemaVersion = "1.0"): void {
  OUT.write(JSON.stringify({ schema_version: schemaVersion, ...payload }, null, 2));
  OUT.write("\n");
}
