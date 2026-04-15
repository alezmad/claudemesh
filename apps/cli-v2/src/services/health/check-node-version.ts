import type { CheckResult } from "./types.js";

export function checkNodeVersion(): CheckResult {
  const major = parseInt(process.version.slice(1), 10);
  if (major >= 20) return { name: "node-version", ok: true, message: `Node ${process.version}` };
  return { name: "node-version", ok: false, message: `Node ${process.version} — requires >= 20` };
}
