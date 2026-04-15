import { VERSION } from "~/constants/urls.js";
import { HIDE_CURSOR, SHOW_CURSOR, CLEAR_SCREEN, CLEAR_LINE, moveTo, boldOrange, dim, visibleLength } from "./styles.js";

export function termSize(): { cols: number; rows: number } {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}
export function center(s: string): string {
  const pad = Math.max(0, Math.floor((termSize().cols - visibleLength(s)) / 2));
  return " ".repeat(pad) + s;
}
export function writeCentered(row: number, s: string): void {
  process.stdout.write(moveTo(row, 1) + center(s) + CLEAR_LINE);
}
export function drawTopBar(extra?: string): void {
  const { cols } = termSize();
  const bg = "\x1b[48;5;208m\x1b[30m"; const reset = "\x1b[0m";
  const left = " claudemesh v" + VERSION; const right = "claudemesh.com ";
  const mid = extra ? "  " + extra : "";
  const gap = Math.max(1, cols - left.length - right.length - mid.length);
  process.stdout.write(moveTo(1, 1) + bg + left + mid + " ".repeat(gap) + right + reset);
}
export function drawBottomBar(left: string, right?: string): void {
  const { cols, rows } = termSize();
  const bg = "\x1b[48;5;208m\x1b[30m"; const reset = "\x1b[0m";
  const l = " " + left; const r = right ? right + " " : "";
  const gap = Math.max(1, cols - l.length - r.length);
  process.stdout.write(moveTo(rows, 1) + bg + l + " ".repeat(gap) + r + reset);
}
export function enterFullScreen(): void { process.stdout.write(HIDE_CURSOR + CLEAR_SCREEN); drawTopBar(); }
export function exitFullScreen(): void { process.stdout.write(SHOW_CURSOR + CLEAR_SCREEN); }
export function drawRule(row: number): void { const { cols } = termSize(); writeCentered(row, dim("\u2500".repeat(Math.min(60, cols - 4)))); }

import { createInterface } from "node:readline";
import { bold, green } from "./styles.js";

export async function menuSelect(
  itemsOrOpts: string[] | { title?: string; items: string[]; row?: number },
  prompt = "Choice",
): Promise<number> {
  const items = Array.isArray(itemsOrOpts) ? itemsOrOpts : itemsOrOpts.items;
  const title = !Array.isArray(itemsOrOpts) ? itemsOrOpts.title : undefined;
  if (title) console.log(`\n  ${title}`);
  items.forEach((item, i) => console.log(`    ${bold(String(i + 1) + ")")} ${item}`));
  console.log("");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${prompt} [1]: `, (answer) => {
      rl.close();
      const idx = parseInt(answer || "1", 10) - 1;
      resolve(idx >= 0 && idx < items.length ? idx : 0);
    });
  });
}

export async function textInput(
  promptOrOpts: string | { label: string; row?: number; placeholder?: string },
  defaultVal = "",
): Promise<string> {
  const label = typeof promptOrOpts === "string" ? promptOrOpts : promptOrOpts.label;
  const placeholder = typeof promptOrOpts === "object" ? promptOrOpts.placeholder : undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const hint = placeholder ? ` (${placeholder})` : defaultVal ? ` [${defaultVal}]` : "";
    rl.question(`  ${label}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function confirmPrompt(
  promptOrOpts: string | { message: string; row?: number; defaultYes?: boolean },
  defaultYes = true,
): Promise<boolean> {
  const message = typeof promptOrOpts === "string" ? promptOrOpts : promptOrOpts.message;
  const defYes = typeof promptOrOpts === "object" && promptOrOpts.defaultYes !== undefined ? promptOrOpts.defaultYes : defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defYes ? "[Y/n]" : "[y/N]";
  return new Promise((resolve) => {
    rl.question(`  ${message} ${hint}: `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

export function splashScreen(opts?: { subtitle?: string; status?: string }) {
  const { createSpinner, FRAME_HEIGHT } = require("./spinner") as typeof import("./spinner.js");
  enterFullScreen();
  const { rows } = termSize();
  const logoTop = Math.floor((rows - FRAME_HEIGHT - 6) / 2);
  const brandRow = logoTop + FRAME_HEIGHT + 1;
  const subtitleRow = brandRow + 1;
  const statusRow = subtitleRow + 2;

  writeCentered(brandRow, boldOrange("claudemesh"));
  if (opts?.subtitle) writeCentered(subtitleRow, dim(opts.subtitle));
  if (opts?.status) writeCentered(statusRow, opts.status);

  const spinner = createSpinner({
    render(lines) { for (let i = 0; i < lines.length; i++) writeCentered(logoTop + i, lines[i]!); },
    interval: 70,
  });
  spinner.start();

  return {
    setStatus(text: string) { writeCentered(statusRow, text + CLEAR_LINE); },
    setSubtitle(text: string) { writeCentered(subtitleRow, dim(text) + CLEAR_LINE); },
    stop() { spinner.stop(); },
    exit() { spinner.stop(); exitFullScreen(); },
  };
}
