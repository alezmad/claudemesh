import { findClaudeBinary } from "~/services/spawn/facade.js";
import type { CheckResult } from "./types.js";

export function checkClaudeBinary(): CheckResult {
  const bin = findClaudeBinary();
  if (bin) return { name: "claude-binary", ok: true, message: `Found at ${bin}` };
  return { name: "claude-binary", ok: false, message: "Claude binary not found" };
}
