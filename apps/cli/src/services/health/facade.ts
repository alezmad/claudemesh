import { checkNodeVersion } from "./check-node-version.js";
import { checkClaudeBinary } from "./check-claude-binary.js";
import { checkMcpRegistered } from "./check-mcp-registered.js";
import { checkHooksRegistered } from "./check-hooks-registered.js";
import { checkConfigPerms } from "./check-config-perms.js";
import { checkKeypairsValid } from "./check-keypairs-valid.js";
import type { CheckResult } from "./types.js";

export type { CheckResult };

const CHECKS: Record<string, () => CheckResult> = {
  "node-version": checkNodeVersion,
  "claude-binary": checkClaudeBinary,
  "mcp-registered": checkMcpRegistered,
  "hooks-registered": checkHooksRegistered,
  "config-perms": checkConfigPerms,
  "keypairs-valid": checkKeypairsValid,
};

export function runAllChecks(): CheckResult[] {
  return Object.values(CHECKS).map((fn) => fn());
}

export function runCheck(name: string): CheckResult | null {
  const fn = CHECKS[name];
  return fn ? fn() : null;
}
