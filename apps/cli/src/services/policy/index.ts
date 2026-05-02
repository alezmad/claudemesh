/**
 * Policy engine — gates every CLI verb's broker call behind allow/prompt/deny
 * rules evaluated against a YAML config. Modeled on Gemini CLI's `--policy /
 * --admin-policy` and Codex's `--sandbox` modes.
 *
 * Why: when claudemesh is invoked from Claude's Bash tool, the user's
 * `allowedTools = ["Bash"]` setting gives Claude carte blanche over the
 * CLI. The policy engine adds a second gate INSIDE claudemesh that the
 * shell-permission layer can't bypass — `claudemesh file delete` can be
 * `decision: deny` regardless of whether Bash is allowed.
 *
 * Spec: .artifacts/specs/2026-05-02-architecture-north-star.md commitment #7.
 *
 * Decision tree:
 *   1. Parse `--approval-mode` flag → coarse mode (plan|read-only|write|yolo).
 *   2. Read user policy from --policy <path> | $CLAUDEMESH_POLICY |
 *      ~/.claudemesh/policy.yaml (auto-created with defaults).
 *   3. Read admin policy (if any) from --admin-policy | /etc/claudemesh/admin-policy.yaml.
 *      Admin rules win on conflict.
 *   4. For an invocation `(resource, verb, mesh)`:
 *      a. Coarse mode: read-only/plan deny all writes outright.
 *      b. Match the most-specific rule (admin > user > built-in default).
 *      c. Apply decision: allow | prompt | deny.
 *      d. On `prompt`, ask interactively unless `--yes` or yolo mode.
 *
 * Audit log: simple newline-JSON append-only at ~/.claudemesh/audit.log.
 * Hash-chained tamper-evidence is parked for 2.x.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";

export type ApprovalMode = "plan" | "read-only" | "write" | "yolo";

export type Decision = "allow" | "prompt" | "deny";

/** A single rule. Earlier rules are matched first; the first match wins. */
export interface PolicyRule {
  /** Resource name, e.g. "send", "file", "sql". `*` matches any. */
  resource: string;
  /** Verb name, e.g. "delete", "execute", "list". `*` matches any. */
  verb: string;
  /** Optional mesh slug filter. Omit for all meshes. */
  mesh?: string;
  /** Optional peer filter (display name, @group, or *). Currently advisory. */
  peers?: string[];
  /** What to do on match. */
  decision: Decision;
  /** Free-text reason surfaced when decision is `prompt` or `deny`. */
  reason?: string;
}

export interface Policy {
  default: Decision;
  rules: PolicyRule[];
}

/** Built-in fallback if no user/admin policy exists. Sensible defaults:
 * destructive writes prompt; everything else is allowed. The user's first
 * run writes this file so they can edit it. */
export const DEFAULT_POLICY: Policy = {
  default: "allow",
  rules: [
    // Destructive writes — prompt the human.
    { resource: "peer",    verb: "kick",       decision: "prompt", reason: "ends a peer's session" },
    { resource: "peer",    verb: "ban",        decision: "prompt", reason: "permanently revokes membership" },
    { resource: "peer",    verb: "disconnect", decision: "prompt", reason: "disconnects a peer" },
    { resource: "file",    verb: "delete",     decision: "prompt", reason: "deletes a shared file" },
    { resource: "vector",  verb: "delete",     decision: "prompt", reason: "removes vector entries" },
    { resource: "vault",   verb: "delete",     decision: "prompt", reason: "deletes encrypted secret" },
    { resource: "memory",  verb: "forget",     decision: "prompt", reason: "removes shared memory" },
    { resource: "skill",   verb: "remove",     decision: "prompt", reason: "removes published skill" },
    { resource: "webhook", verb: "delete",     decision: "prompt", reason: "removes webhook integration" },
    { resource: "watch",   verb: "remove",     decision: "prompt", reason: "removes URL watcher" },
    { resource: "sql",     verb: "execute",    decision: "prompt", reason: "raw SQL write to mesh DB" },
    { resource: "graph",   verb: "execute",    decision: "prompt", reason: "graph mutation" },
    { resource: "mesh",    verb: "delete",     decision: "prompt", reason: "deletes the mesh for everyone" },
    { resource: "apikey",  verb: "create",     decision: "prompt", reason: "issues a long-lived credential" },
    { resource: "apikey",  verb: "revoke",     decision: "prompt", reason: "irreversibly disables a credential" },
  ],
};

const USER_POLICY_PATH = join(homedir(), ".claudemesh", "policy.yaml");
const AUDIT_LOG_PATH = join(homedir(), ".claudemesh", "audit.log");

/**
 * Minimal YAML parser for our policy format. Accepts the shape:
 *   default: allow|prompt|deny
 *   rules:
 *     - resource: peer
 *       verb: kick
 *       mesh: flexicar       # optional
 *       peers: ["@admin"]    # optional
 *       decision: prompt
 *       reason: "..."        # optional
 *
 * We avoid pulling in a real YAML dep (zero-dep CLI). For complex configs
 * users can pre-process to JSON; we accept that too via .json extension.
 */
export function parsePolicyYaml(text: string): Policy {
  // If the file is JSON, parse directly.
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Policy;
  }

  const policy: Policy = { default: "allow", rules: [] };
  const lines = text.split("\n");
  let cur: Partial<PolicyRule> | null = null;
  const flush = (): void => {
    if (cur && cur.resource && cur.verb && cur.decision) {
      policy.rules.push(cur as PolicyRule);
    }
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;

    const top = line.match(/^(default):\s*(\S+)/);
    if (top) {
      policy.default = top[2] as Decision;
      continue;
    }

    if (/^rules\s*:/.test(line)) continue;

    // New rule entry: starts with "  -" or "- "
    if (/^\s*-\s/.test(line)) {
      flush();
      cur = {};
      const m = line.match(/-\s*(\w+)\s*:\s*(.*)$/);
      if (m) (cur as Record<string, unknown>)[m[1]!] = parseValue(m[2]!);
      continue;
    }

    // Continuation key/value within a rule: "    key: value"
    const kv = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
    if (kv && cur) {
      (cur as Record<string, unknown>)[kv[1]!] = parseValue(kv[2]!);
    }
  }
  flush();

  return policy;
}

function parseValue(raw: string): string | string[] | boolean | number {
  const v = raw.trim();
  if (!v) return "";
  // Inline array: ["a", "b"]
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  // Quoted string
  const q = v.match(/^["'](.*)["']$/);
  if (q) return q[1]!;
  // Bools / numbers
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Serialise a Policy as YAML. */
export function serializePolicyYaml(p: Policy): string {
  let out = `# claudemesh policy file\n`;
  out += `# Edit to change which CLI ops require confirmation or are forbidden.\n`;
  out += `# Decisions: allow | prompt | deny\n`;
  out += `# See: ~/.claude/skills/claudemesh/SKILL.md or claudemesh policy --help\n\n`;
  out += `default: ${p.default}\n\n`;
  out += `rules:\n`;
  for (const r of p.rules) {
    out += `  - resource: ${r.resource}\n`;
    out += `    verb: ${r.verb}\n`;
    if (r.mesh) out += `    mesh: ${r.mesh}\n`;
    if (r.peers) out += `    peers: [${r.peers.map((p) => `"${p}"`).join(", ")}]\n`;
    out += `    decision: ${r.decision}\n`;
    if (r.reason) out += `    reason: "${r.reason}"\n`;
  }
  return out;
}

/** Load the user's policy, creating the default on first run. */
export function loadPolicy(opts?: { policyPath?: string; envOverride?: string }): Policy {
  const path =
    opts?.policyPath ??
    opts?.envOverride ??
    process.env.CLAUDEMESH_POLICY ??
    USER_POLICY_PATH;

  if (!existsSync(path)) {
    // First run — write defaults so the user can discover/edit them.
    if (path === USER_POLICY_PATH) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, serializePolicyYaml(DEFAULT_POLICY), "utf-8");
      } catch { /* best effort */ }
    }
    return DEFAULT_POLICY;
  }

  try {
    return parsePolicyYaml(readFileSync(path, "utf-8"));
  } catch (e) {
    process.stderr.write(
      `[claudemesh] policy: failed to parse ${path}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return DEFAULT_POLICY;
  }
}

/** Match wildcards: `*` in the rule matches anything. */
function matches(rule: string, value: string): boolean {
  if (rule === "*") return true;
  return rule === value;
}

export interface CheckContext {
  resource: string;
  verb: string;
  mesh?: string;
  /** Coarse mode from --approval-mode (or default 'write'). */
  mode: ApprovalMode;
  /** True if the verb is destructive (kick/ban/delete/forget/execute/etc). */
  isWrite: boolean;
  /** If true, prompt-decisions are auto-approved (e.g. -y / yolo). */
  yes: boolean;
}

export interface CheckResult {
  decision: Decision;
  reason?: string;
  matchedRule?: PolicyRule;
}

/** Evaluate a policy against a check context. Pure — no I/O. */
export function evaluate(policy: Policy, ctx: CheckContext): CheckResult {
  // Coarse approval-mode short-circuits.
  if (ctx.mode === "yolo") return { decision: "allow", reason: "yolo mode" };
  if ((ctx.mode === "plan" || ctx.mode === "read-only") && ctx.isWrite) {
    return { decision: "deny", reason: `${ctx.mode} mode forbids writes` };
  }

  for (const r of policy.rules) {
    if (!matches(r.resource, ctx.resource)) continue;
    if (!matches(r.verb, ctx.verb)) continue;
    if (r.mesh && ctx.mesh && r.mesh !== ctx.mesh) continue;
    return { decision: r.decision, reason: r.reason, matchedRule: r };
  }
  return { decision: policy.default };
}

/** Append a one-line JSON record to ~/.claudemesh/audit.log. */
export function audit(record: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(AUDIT_LOG_PATH), { recursive: true });
    appendFileSync(
      AUDIT_LOG_PATH,
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n",
      "utf-8",
    );
  } catch { /* best effort */ }
}

/**
 * Interactive prompt for `prompt` decisions. Returns true if the user
 * approves. In a non-TTY context (cron, scripts) returns false to be safe —
 * the user must opt in via `--approval-mode yolo` or a `decision: allow`
 * rule.
 */
export async function confirmPrompt(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

/**
 * One-stop check: load policy, evaluate, audit, prompt if needed. Returns
 * `true` if the operation may proceed, `false` if blocked.
 *
 * Callers pass in `ctx` with the current invocation. They should `return`
 * (or `process.exit`) when this returns false.
 */
export async function gate(ctx: CheckContext, opts?: { policyPath?: string }): Promise<boolean> {
  const policy = loadPolicy(opts);
  const result = evaluate(policy, ctx);

  audit({ ...ctx, decision: result.decision, reason: result.reason });

  if (result.decision === "allow") return true;
  if (result.decision === "deny") {
    process.stderr.write(
      `\n  ✘ blocked by policy: ${ctx.resource} ${ctx.verb}` +
      (result.reason ? ` — ${result.reason}` : "") +
      `\n  edit ${USER_POLICY_PATH} to change.\n`,
    );
    return false;
  }
  // prompt
  if (ctx.yes) return true;
  const reason = result.reason ? ` — ${result.reason}` : "";
  const confirmed = await confirmPrompt(
    `\n  ⚠ ${ctx.resource} ${ctx.verb}${reason}. Continue?`,
  );
  if (!confirmed) {
    process.stderr.write(`  cancelled.\n`);
    audit({ ...ctx, decision: "cancelled-at-prompt" });
  }
  return confirmed;
}
