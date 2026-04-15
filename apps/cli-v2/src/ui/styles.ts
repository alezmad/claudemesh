const isTTY =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const esc = (code: string) => (s: string) =>
  isTTY ? `${code}${s}\x1b[0m` : s;

export const orange = esc("\x1b[38;5;208m");
export const clay = esc("\x1b[38;5;173m");
export const amber = esc("\x1b[38;5;214m");

export const bold = esc("\x1b[1m");
export const dim = esc("\x1b[2m");
export const green = esc("\x1b[32m");
export const yellow = esc("\x1b[33m");
export const red = esc("\x1b[31m");
export const cyan = esc("\x1b[36m");
export const boldOrange = esc("\x1b[1m\x1b[38;5;208m");

export const HIDE_CURSOR = isTTY ? "\x1b[?25l" : "";
export const SHOW_CURSOR = isTTY ? "\x1b[?25h" : "";
export const CLEAR_SCREEN = isTTY ? "\x1b[2J\x1b[H" : "";
export const CLEAR_LINE = isTTY ? "\x1b[K" : "";

export function moveTo(row: number, col: number): string {
  return isTTY ? `\x1b[${row};${col}H` : "";
}

export function moveUp(n: number): string {
  return isTTY ? `\x1b[${n}A` : "";
}

export function visibleLength(s: string): number {
  return s.replace(/\x1b\[[^m]*m/g, "").length;
}

export const icons = {
  check: "✔",
  cross: "✘",
  warn: "⚠",
  arrow: "→",
  bullet: "●",
  dash: "—",
  ellipsis: "…",
} as const;
