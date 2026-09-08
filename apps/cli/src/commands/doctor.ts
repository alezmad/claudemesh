/**
 * `claudemesh doctor` — diagnostic checks.
 *
 * Walks through the install + runtime preconditions and prints each
 * as pass/fail with a fix hint on failure. Exit 0 if everything
 * passes, 1 otherwise.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readConfig, getConfigPath } from "~/services/config/facade.js";
import { VERSION, URLS } from "~/constants/urls.js";
import { DAEMON_PATHS } from "~/daemon/paths.js";
import { isInstalledUnitStale } from "~/daemon/service-install.js";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
  fix?: string;
}

function checkNode(): Check {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    name: "Node.js >= 20",
    pass: major >= 20,
    detail: `v${process.versions.node}`,
    fix: "Install Node 20 or newer (https://nodejs.org)",
  };
}

function checkClaudeOnPath(): Check {
  const res =
    platform() === "win32"
      ? spawnSync("where", ["claude"])
      : spawnSync("sh", ["-c", "command -v claude"]);
  const onPath = res.status === 0;
  const location = onPath ? res.stdout.toString().trim().split("\n")[0] : undefined;
  return {
    name: "claude binary on PATH",
    pass: onPath,
    detail: location,
    fix: "Install Claude Code (https://claude.com/claude-code)",
  };
}

function checkMcpRegistered(): Check {
  const claudeConfig = join(homedir(), ".claude.json");
  if (!existsSync(claudeConfig)) {
    return {
      name: "claudemesh MCP registered in ~/.claude.json",
      pass: false,
      fix: "Run `claudemesh install`",
    };
  }
  try {
    const cfg = JSON.parse(readFileSync(claudeConfig, "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    const registered = Boolean(cfg.mcpServers?.["claudemesh"]);
    return {
      name: "claudemesh MCP registered in ~/.claude.json",
      pass: registered,
      fix: registered ? undefined : "Run `claudemesh install`",
    };
  } catch (e) {
    return {
      name: "claudemesh MCP registered in ~/.claude.json",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
      fix: "Check ~/.claude.json for JSON parse errors",
    };
  }
}

function checkHooksRegistered(): Check {
  const settings = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settings)) {
    return {
      name: "Status hooks registered in ~/.claude/settings.json",
      pass: false,
      fix: "Run `claudemesh install` (remove --no-hooks)",
    };
  }
  try {
    const raw = readFileSync(settings, "utf-8");
    const has = raw.includes("claudemesh hook ");
    return {
      name: "Status hooks registered in ~/.claude/settings.json",
      pass: has,
      fix: has ? undefined : "Run `claudemesh install` (remove --no-hooks)",
    };
  } catch (e) {
    return {
      name: "Status hooks registered in ~/.claude/settings.json",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

function checkConfigFile(): Check {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return {
      name: "~/.claudemesh/config.json exists and parses",
      pass: true,
      detail: "not created yet (fine — no meshes joined)",
    };
  }
  try {
    readConfig();
    const st = statSync(path);
    const mode = (st.mode & 0o777).toString(8);
    const secure = platform() === "win32" || mode === "600";
    return {
      name: "~/.claudemesh/config.json parses + chmod 0600",
      pass: secure,
      detail: platform() === "win32" ? "chmod skipped on Windows" : `0${mode}`,
      fix: secure ? undefined : `chmod 600 ${path}`,
    };
  } catch (e) {
    return {
      name: "~/.claudemesh/config.json exists and parses",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
      fix: "Inspect or delete ~/.claudemesh/config.json and re-join",
    };
  }
}

function checkKeypairs(): Check {
  try {
    const cfg = readConfig();
    if (cfg.meshes.length === 0) {
      return {
        name: "Mesh keypairs valid",
        pass: true,
        detail: "no meshes joined",
      };
    }
    for (const m of cfg.meshes) {
      if (m.pubkey.length !== 64 || !/^[0-9a-f]+$/.test(m.pubkey)) {
        return {
          name: "Mesh keypairs valid",
          pass: false,
          detail: `${m.slug}: pubkey malformed`,
          fix: `Leave + re-join the mesh: claudemesh leave ${m.slug}`,
        };
      }
      if (m.secretKey.length !== 128 || !/^[0-9a-f]+$/.test(m.secretKey)) {
        return {
          name: "Mesh keypairs valid",
          pass: false,
          detail: `${m.slug}: secret key malformed`,
          fix: `Leave + re-join the mesh: claudemesh leave ${m.slug}`,
        };
      }
    }
    return {
      name: "Mesh keypairs valid",
      pass: true,
      detail: `${cfg.meshes.length} mesh(es)`,
    };
  } catch (e) {
    return {
      name: "Mesh keypairs valid",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkBrokerWs(): Promise<Check> {
  const wsUrl = URLS.BROKER;
  const start = Date.now();
  try {
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(wsUrl);
    const result = await new Promise<Check>((resolve) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* noop */ }
        resolve({
          name: "Broker WebSocket reachable",
          pass: false,
          detail: `timeout after 5s (${wsUrl})`,
          fix: "Check firewall/proxy. Broker at ic.claudemesh.com:443 over WSS.",
        });
      }, 5000);
      ws.once("open", () => {
        clearTimeout(timer);
        const latency = Date.now() - start;
        try { ws.close(); } catch { /* noop */ }
        resolve({
          name: "Broker WebSocket reachable",
          pass: true,
          detail: `${latency}ms to ${wsUrl}`,
        });
      });
      ws.once("error", (e) => {
        clearTimeout(timer);
        resolve({
          name: "Broker WebSocket reachable",
          pass: false,
          detail: e.message,
          fix: "Check network. Broker URL can be overridden via CLAUDEMESH_BROKER_URL.",
        });
      });
    });
    return result;
  } catch (e) {
    return {
      name: "Broker WebSocket reachable",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkNpmLatest(): Promise<Check> {
  try {
    const res = await fetch(URLS.NPM_REGISTRY, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { name: "CLI up-to-date", pass: true, detail: `npm unreachable (${res.status}) — skipped` };
    }
    const body = (await res.json()) as { "dist-tags"?: { alpha?: string; latest?: string } };
    const latest = body["dist-tags"]?.latest ?? body["dist-tags"]?.alpha;
    if (!latest) return { name: "CLI up-to-date", pass: true, detail: "no dist-tag — skipped" };
    const up = latest === VERSION;
    return {
      name: "CLI up-to-date",
      pass: up,
      detail: up ? `latest ${latest}` : `installed ${VERSION} → latest ${latest}`,
      fix: up ? undefined : "npm i -g claudemesh-cli",
    };
  } catch {
    return { name: "CLI up-to-date", pass: true, detail: "npm check skipped" };
  }
}


// ── 1.37.1 daemon / mesh liveness checks ───────────────────────────────
//
// Added after the 2026-09-08 blackout: 8 sessions registered with the
// daemon, every WS "hello_acked", and yet `peer list` returned 0 on all
// meshes for 40 minutes. Nothing told the user. These checks cross-check
// what the daemon believes (its own WS state) against what the broker
// reports (the peer list), and always name the one-command fix.

const RESTART_FIX = "claudemesh daemon restart";
const REINSTALL_FIX = "claudemesh daemon install-service && launchctl kickstart -k gui/$(id -u)/com.claudemesh.daemon";
const LOG_SIZE_LIMIT = 200 * 1024 * 1024;

interface DiagMesh { status: string; isOpen: boolean; lastAckAt: string | null; reconnects: number }
interface DiagSession {
  sessionId: string; mesh: string; displayName: string; pid: number;
  sessionPubkey: string | null; sessionPubkeyPrefix: string | null;
  ws: { status: string; isOpen: boolean };
}
interface Diagnostics {
  pid: number; version: string; uptime_s: number;
  log: { path: string; bytes: number; rotating: boolean };
  meshes: Record<string, DiagMesh>;
  sessions: DiagSession[];
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/**
 * Fetch the daemon's self-report. Returns `{ state: "down" }` when no
 * daemon runs, `{ state: "old" }` when it predates `/v1/diagnostics`.
 */
async function fetchDiagnostics(): Promise<
  | { state: "ok"; diag: Diagnostics }
  | { state: "down" }
  | { state: "old"; version: string | null }
  | { state: "error"; detail: string }
> {
  const { readRunningPid } = await import("~/daemon/lock.js");
  if (!readRunningPid()) return { state: "down" };
  try {
    const { ipc } = await import("~/daemon/ipc/client.js");
    const res = await ipc<Diagnostics | { error?: string }>({ path: "/v1/diagnostics", timeoutMs: 3_000 });
    if (res.status === 200 && res.body && "meshes" in res.body) return { state: "ok", diag: res.body as Diagnostics };
    let version: string | null = null;
    try {
      const v = await ipc<{ daemon_version?: string }>({ path: "/v1/version", timeoutMs: 2_000 });
      version = v.body?.daemon_version ?? null;
    } catch { /* ignore */ }
    return { state: "old", version };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

async function daemonChecks(): Promise<Check[]> {
  const skipped = (name: string, detail: string): Check => ({ name, pass: true, detail });
  const r = await fetchDiagnostics();
  const names = {
    version: "Daemon running on the installed CLI version",
    meshWs: "Daemon connected to the broker on every mesh",
    sessionWs: "Every registered session has an open broker WS",
    ghosts: "Every registered session is visible in the broker peer list",
    log: "daemon.log bounded + service unit current",
  };

  if (r.state === "down") {
    return [
      { name: names.version, pass: false, detail: "daemon not running", fix: "claudemesh daemon up  (or: claudemesh daemon install-service)" },
      skipped(names.meshWs, "daemon not running — skipped"),
      skipped(names.sessionWs, "daemon not running — skipped"),
      skipped(names.ghosts, "daemon not running — skipped"),
      logAndUnitCheck(null),
    ];
  }
  if (r.state === "error") {
    return [
      { name: names.version, pass: false, detail: `daemon IPC unreachable: ${r.detail}`, fix: RESTART_FIX },
      skipped(names.meshWs, "IPC unreachable — skipped"),
      skipped(names.sessionWs, "IPC unreachable — skipped"),
      skipped(names.ghosts, "IPC unreachable — skipped"),
      logAndUnitCheck(null),
    ];
  }
  if (r.state === "old") {
    return [
      {
        name: names.version, pass: false,
        detail: `running daemon ${r.version ?? "(unknown)"} predates /v1/diagnostics; CLI is ${VERSION}`,
        fix: RESTART_FIX,
      },
      skipped(names.meshWs, "old daemon — skipped"),
      skipped(names.sessionWs, "old daemon — skipped"),
      skipped(names.ghosts, "old daemon — skipped"),
      logAndUnitCheck(null),
    ];
  }

  const d = r.diag;
  const checks: Check[] = [];

  // (a) version parity — an upgraded CLI with a stale daemon is how a
  // fix "ships" but never runs.
  const sameVersion = d.version === VERSION;
  checks.push({
    name: names.version,
    pass: sameVersion,
    detail: sameVersion ? `v${d.version}, pid ${d.pid}, up ${d.uptime_s}s` : `daemon v${d.version} ≠ CLI v${VERSION}`,
    fix: sameVersion ? undefined : RESTART_FIX,
  });

  // (b) member WS per mesh.
  const badMeshes = Object.entries(d.meshes).filter(([, m]) => m.status !== "open" || !m.isOpen);
  checks.push({
    name: names.meshWs,
    pass: badMeshes.length === 0,
    detail: badMeshes.length === 0
      ? `${Object.keys(d.meshes).length} mesh(es) open`
      : badMeshes.map(([slug, m]) => `${slug}: ${m.status}`).join(", "),
    fix: badMeshes.length === 0 ? undefined : RESTART_FIX,
  });

  // (c) session WS per registered session.
  const badSessions = d.sessions.filter((s) => s.ws.status !== "open" || !s.ws.isOpen);
  checks.push({
    name: names.sessionWs,
    pass: badSessions.length === 0,
    detail: badSessions.length === 0
      ? `${d.sessions.length} session(s)`
      : badSessions.map((s) => `${s.displayName}@${s.mesh}: ${s.ws.status}`).join(", "),
    fix: badSessions.length === 0 ? undefined : RESTART_FIX,
  });

  // (d) GHOST DETECTOR — the exact 2026-09-08 signature: the daemon says
  // the session WS is open, the broker has no presence for it. Ask the
  // broker (via the daemon's member WS) for each mesh's peer list and
  // require every registered session pubkey to be in it.
  checks.push(await ghostCheck(d, names.ghosts));

  // (e) log size + service unit.
  checks.push(logAndUnitCheck(d));
  return checks;
}

async function ghostCheck(d: Diagnostics, name: string): Promise<Check> {
  const byMesh = new Map<string, DiagSession[]>();
  for (const s of d.sessions) {
    if (!s.sessionPubkey) continue;
    const arr = byMesh.get(s.mesh) ?? [];
    arr.push(s);
    byMesh.set(s.mesh, arr);
  }
  if (byMesh.size === 0) return { name, pass: true, detail: "no registered sessions" };
  const { ipc } = await import("~/daemon/ipc/client.js");
  const missing: string[] = [];
  const unreachable: string[] = [];
  let checked = 0;
  for (const [mesh, sessions] of byMesh) {
    let pubkeys = new Set<string>();
    try {
      const res = await ipc<{ peers?: Array<{ pubkey?: string }>; brokers?: Record<string, string> }>({
        path: `/v1/peers?mesh=${encodeURIComponent(mesh)}`, timeoutMs: 6_000,
      });
      if (res.status !== 200) { unreachable.push(`${mesh}: http ${res.status}`); continue; }
      if (res.body.brokers && res.body.brokers[mesh] && res.body.brokers[mesh] !== "open") {
        unreachable.push(`${mesh}: member WS ${res.body.brokers[mesh]}`);
        continue;
      }
      pubkeys = new Set((res.body.peers ?? []).map((p) => String(p.pubkey ?? "").toLowerCase()));
    } catch (e) {
      unreachable.push(`${mesh}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const s of sessions) {
      checked++;
      if (!pubkeys.has(s.sessionPubkey!.toLowerCase())) {
        missing.push(`${s.displayName}@${mesh} (${s.sessionPubkeyPrefix}…)`);
      }
    }
  }
  if (missing.length === 0 && unreachable.length === 0) {
    return { name, pass: true, detail: `${checked} session(s) visible on the mesh` };
  }
  const parts: string[] = [];
  if (missing.length) parts.push(`GHOST — registered but not in peer list: ${missing.join(", ")}`);
  if (unreachable.length) parts.push(`could not verify: ${unreachable.join(", ")}`);
  return { name, pass: false, detail: parts.join(" · "), fix: RESTART_FIX };
}

function logAndUnitCheck(d: Diagnostics | null): Check {
  const name = "daemon.log bounded + service unit current";
  const problems: string[] = [];
  const fixes: string[] = [];
  let bytes = d?.log.bytes ?? 0;
  if (!d) { try { bytes = statSync(DAEMON_PATHS.LOG_FILE).size; } catch { bytes = 0; } }
  if (bytes >= LOG_SIZE_LIMIT) {
    problems.push(`daemon.log is ${fmtBytes(bytes)} (limit ${fmtBytes(LOG_SIZE_LIMIT)})`);
    fixes.push(`${RESTART_FIX}  (1.37.1+ daemon rotates it at 20 MB)`);
  }
  if (d && !d.log.rotating) {
    problems.push("running daemon is not rotating its log");
  }
  try {
    const st = isInstalledUnitStale();
    if (st.stale) {
      problems.push(`service unit stale: ${st.reason}`);
      fixes.push(REINSTALL_FIX);
    }
  } catch { /* no unit / unsupported platform */ }
  return {
    name,
    pass: problems.length === 0,
    detail: problems.length === 0 ? `daemon.log ${fmtBytes(bytes)}${d?.log.rotating ? ", rotating" : ""}` : problems.join(" · "),
    fix: problems.length === 0 ? undefined : [...new Set(fixes)].join("  ;  "),
  };
}

export async function runDoctor(): Promise<void> {
  const useColor =
    !process.env.NO_COLOR && process.env.TERM !== "dumb" && process.stdout.isTTY;
  const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
  const green = (s: string): string => (useColor ? `\x1b[32m${s}\x1b[39m` : s);
  const red = (s: string): string => (useColor ? `\x1b[31m${s}\x1b[39m` : s);

  console.log(`claudemesh doctor  (v${VERSION})`);
  console.log("─".repeat(60));

  const checks: Check[] = [
    checkNode(),
    checkClaudeOnPath(),
    checkMcpRegistered(),
    checkHooksRegistered(),
    checkConfigFile(),
    checkKeypairs(),
    await checkBrokerWs(),
    await checkNpmLatest(),
    ...(await daemonChecks()),
  ];

  for (const c of checks) {
    const mark = c.pass ? green("✓") : red("✗");
    const detail = c.detail ? dim(` (${c.detail})`) : "";
    console.log(`${mark} ${c.name}${detail}`);
    if (!c.pass && c.fix) {
      console.log(dim(`   → ${c.fix}`));
    }
  }

  const failing = checks.filter((c) => !c.pass);
  console.log("");
  if (failing.length === 0) {
    console.log(green("All checks passed."));
    process.exit(0);
  } else {
    console.log(red(`${failing.length} check(s) failed.`));
    process.exit(1);
  }
}
