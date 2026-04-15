export function isNewer(current: string, latest: string): boolean {
  const cp = current.split(".").map(Number);
  const lp = latest.split(".").map(Number);
  const a = cp[0] ?? 0, b = cp[1] ?? 0, c = cp[2] ?? 0;
  const x = lp[0] ?? 0, y = lp[1] ?? 0, z = lp[2] ?? 0;
  return x > a || (x === a && y > b) || (x === a && y === b && z > c);
}
