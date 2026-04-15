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
    const latest = body["dist-tags"]?.alpha ?? body["dist-tags"]?.latest;
    if (!latest) return { name: "CLI up-to-date", pass: true, detail: "no dist-tag — skipped" };
    const up = latest === VERSION;
    return {
      name: "CLI up-to-date",
      pass: up,
      detail: up ? `latest ${latest}` : `installed ${VERSION} → latest ${latest}`,
      fix: up ? undefined : "npm i -g claudemesh-cli@alpha",
    };
  } catch {
    return { name: "CLI up-to-date", pass: true, detail: "npm check skipped" };
  }
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
