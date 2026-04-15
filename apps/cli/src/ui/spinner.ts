import { boldOrange, clay, dim, visibleLength } from "./styles.js";

const W = 7, H = 5, CX = 3, CY = 2, RX = 3, RY = 2, TOTAL = 12;

function edgeChar(dx: number, dy: number): string {
  const a = Math.abs(dx), b = Math.abs(dy);
  if (b < a * 0.4) return "-";
  if (a < b * 0.4) return "|";
  return (dx > 0) === (dy > 0) ? "\\" : "/";
}

function drawLine(grid: string[][], x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let s = 1; s < steps; s++) {
    const x = Math.round(x0 + dx * s / steps);
    const y = Math.round(y0 + dy * s / steps);
    if (y >= 0 && y < H && x >= 0 && x < W) {
      const c = grid[y]![x]!;
      if (c === " ") grid[y]![x] = edgeChar(dx, dy);
      else if (c !== edgeChar(dx, dy) && c !== "\u25CF") grid[y]![x] = "+";
    }
  }
}

function buildFrame(i: number): string[] {
  const grid = Array.from({ length: H }, () => Array(W).fill(" ") as string[]);
  const base = (i / TOTAL) * Math.PI * 2;
  const nodes = [0, 1, 2, 3].map(n => {
    const a = base + n * Math.PI / 2 - Math.PI / 2;
    return { x: Math.round(CX + RX * Math.cos(a)), y: Math.round(CY + RY * Math.sin(a)) };
  });
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 4; b++)
      drawLine(grid, nodes[a]!.x, nodes[a]!.y, nodes[b]!.x, nodes[b]!.y);
  for (const { x, y } of nodes)
    if (y >= 0 && y < H && x >= 0 && x < W) grid[y]![x] = "\u25CF";
  return grid.map(r => r.join(""));
}

const seen = new Set<string>();
const RAW_FRAMES: string[][] = [];
for (let i = 0; i < TOTAL; i++) {
  const f = buildFrame(i);
  const key = f.join("\n");
  if (!seen.has(key)) { seen.add(key); RAW_FRAMES.push(f); }
}

function colorize(line: string): string {
  return line
    .replace(/\u25CF/g, boldOrange("\u25CF"))
    .replace(/[-|/\\+]/g, c => dim(clay(c)));
}

export const FRAME_COUNT = RAW_FRAMES.length;
export const FRAME_HEIGHT = H;
export const FRAME_WIDTH = W;

export function getFrame(index: number): string[] {
  return RAW_FRAMES[index % RAW_FRAMES.length]!.map(colorize);
}

export function getRawFrame(index: number): string[] {
  return RAW_FRAMES[index % RAW_FRAMES.length]!;
}

export function createSpinner(opts: {
  render: (lines: string[]) => void;
  interval?: number;
}) {
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        opts.render(getFrame(frame++));
      }, opts.interval ?? 70);
      opts.render(getFrame(frame++));
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    get isRunning() { return timer !== null; },
  };
}
