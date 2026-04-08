/**
 * claudemesh runner supervisor — manages MCP server child processes.
 *
 * HTTP API (called by broker):
 *   POST /load    { name, sourcePath, env, runtime }  → spawn MCP, return tools
 *   POST /call    { name, tool, args }                → route tool call
 *   POST /unload  { name }                            → kill process
 *   GET  /health                                      → { ok, services }
 *   GET  /list    { name? }                           → tools for a service
 *
 * Each MCP server is a child process with its own stdio pipe.
 * The supervisor talks MCP JSON-RPC over stdin/stdout to each child.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PORT = parseInt(process.env.RUNNER_PORT || "7901", 10);
const CALL_TIMEOUT_MS = 25_000;
const LOG_BUFFER_SIZE = 500;

// --- Service registry ---

const services = new Map();
let callIdCounter = 0;

// --- Runtime detection ---

function detectRuntime(sourcePath) {
  if (existsSync(join(sourcePath, "bun.lockb")) || existsSync(join(sourcePath, "bunfig.toml"))) return "bun";
  if (existsSync(join(sourcePath, "package.json"))) return "node";
  if (existsSync(join(sourcePath, "pyproject.toml")) || existsSync(join(sourcePath, "requirements.txt"))) return "python";
  return "node";
}

function detectEntry(sourcePath, runtime) {
  if (runtime === "python") {
    for (const e of ["server.py", "src/server.py", "main.py", "src/main.py"]) {
      if (existsSync(join(sourcePath, e))) return { cmd: "python3", args: [e] };
    }
    if (existsSync(join(sourcePath, "pyproject.toml"))) return { cmd: "python3", args: ["-m", "server"] };
    return { cmd: "python3", args: ["server.py"] };
  }
  const cmd = runtime === "bun" ? "bun" : "node";
  if (existsSync(join(sourcePath, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(sourcePath, "package.json"), "utf-8"));
      if (pkg.main) return { cmd, args: [pkg.main] };
      if (pkg.bin) {
        const bin = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0];
        if (bin) return { cmd, args: [bin] };
      }
    } catch {}
  }
  for (const e of ["dist/index.js", "src/index.js", "src/index.ts", "index.js"]) {
    if (existsSync(join(sourcePath, e))) return { cmd, args: [e] };
  }
  return { cmd, args: ["src/index.js"] };
}

// --- Install deps ---

function installDeps(sourcePath, runtime) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (runtime === "python") {
      if (existsSync(join(sourcePath, "requirements.txt"))) {
        cmd = "pip3"; args = ["install", "--no-cache-dir", "-r", "requirements.txt"];
      } else { cmd = "pip3"; args = ["install", "--no-cache-dir", "."]; }
    } else if (runtime === "bun") {
      cmd = "bun"; args = ["install"];
    } else {
      cmd = "npm"; args = ["install", "--production", "--legacy-peer-deps"];
    }
    const child = spawn(cmd, args, { cwd: sourcePath, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", d => { stderr += d.toString(); });
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${cmd} install exit ${code}: ${stderr.slice(-300)}`)));
    child.on("error", reject);
  });
}

// --- MCP JSON-RPC ---

function sendMcpRequest(svc, method, params) {
  return new Promise(resolve => {
    if (!svc.process?.stdin?.writable) { resolve({ error: "not running" }); return; }
    const id = `c_${++callIdCounter}`;
    const timer = setTimeout(() => { svc.pending.delete(id); resolve({ error: "timeout" }); }, CALL_TIMEOUT_MS);
    svc.pending.set(id, { resolve, timer });
    try {
      svc.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
    } catch (e) {
      clearTimeout(timer); svc.pending.delete(id);
      resolve({ error: e.message });
    }
  });
}

async function initMcp(svc) {
  const init = await sendMcpRequest(svc, "initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "claudemesh-runner", version: "0.1.0" },
  });
  if (init.error) throw new Error(`init failed: ${init.error}`);
  if (svc.process?.stdin?.writable) {
    svc.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }
  const tools = await sendMcpRequest(svc, "tools/list", {});
  if (tools.error) throw new Error(`tools/list failed: ${tools.error}`);
  return tools.result?.tools ?? [];
}

// --- Spawn ---

function spawnService(svc) {
  // npx packages have a pre-resolved binary
  let cmd, args;
  if (svc._npxBin) {
    cmd = "node";
    args = [svc._npxBin];
  } else {
    ({ cmd, args } = detectEntry(svc.sourcePath, svc.runtime));
  }
  const child = spawn(cmd, args, {
    cwd: svc.sourcePath,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...svc.env, NODE_ENV: "production" },
  });
  svc.process = child;
  svc.pid = child.pid;
  svc.status = "running";
  svc.healthFailures = 0;

  const rl = createInterface({ input: child.stdout });
  rl.on("line", line => {
    try {
      const msg = JSON.parse(line);
      if (msg.id && svc.pending.has(String(msg.id))) {
        const p = svc.pending.get(String(msg.id));
        clearTimeout(p.timer); svc.pending.delete(String(msg.id));
        p.resolve(msg.error ? { error: msg.error.message ?? JSON.stringify(msg.error) } : { result: msg.result });
      }
    } catch { svc.logs.push(`[stdout] ${line}`); if (svc.logs.length > LOG_BUFFER_SIZE) svc.logs.shift(); }
  });

  const errRl = createInterface({ input: child.stderr });
  errRl.on("line", line => { svc.logs.push(`[stderr] ${line}`); if (svc.logs.length > LOG_BUFFER_SIZE) svc.logs.shift(); });

  child.on("exit", (code, signal) => {
    console.log(`[runner] ${svc.name} exited code=${code} signal=${signal} restarts=${svc.restarts}`);
    for (const [, p] of svc.pending) { clearTimeout(p.timer); p.resolve({ error: "crashed" }); }
    svc.pending.clear(); svc.process = null; svc.pid = null;
    if (svc.status === "running" && svc.restarts < 5) {
      svc.restarts++;
      svc.status = "restarting";
      setTimeout(() => spawnService(svc), 1000 * svc.restarts);
    } else if (svc.status === "running") { svc.status = "crashed"; }
  });

  child.on("error", err => { console.error(`[runner] ${svc.name} spawn error: ${err.message}`); svc.status = "failed"; });
  console.log(`[runner] spawned ${svc.name} pid=${child.pid} cmd=${cmd} ${args.join(" ")}`);
}

// --- HTTP API ---

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      const svcs = [];
      for (const [name, svc] of services) {
        svcs.push({ name, status: svc.status, pid: svc.pid, tools: svc.tools.length, restarts: svc.restarts });
      }
      return json(res, 200, { ok: true, services: svcs });
    }

    if (req.method === "GET" && req.url?.startsWith("/list")) {
      const url = new URL(req.url, "http://localhost");
      const name = url.searchParams.get("name");
      if (name) {
        const svc = services.get(name);
        if (!svc) return json(res, 404, { error: `service "${name}" not found` });
        return json(res, 200, { tools: svc.tools });
      }
      const all = {};
      for (const [n, s] of services) all[n] = s.tools;
      return json(res, 200, all);
    }

    if (req.method === "GET" && req.url?.startsWith("/logs")) {
      const url = new URL(req.url, "http://localhost");
      const name = url.searchParams.get("name");
      const lines = parseInt(url.searchParams.get("lines") || "50", 10);
      const svc = services.get(name);
      if (!svc) return json(res, 404, { error: "not found" });
      return json(res, 200, { lines: svc.logs.slice(-lines) });
    }

    if (req.method === "POST" && req.url === "/load") {
      const body = await readBody(req);
      const { name, sourcePath, gitUrl, gitBranch, npxPackage, env: svcEnv, runtime: rt } = body;
      if (!name) return json(res, 400, { error: "name required" });

      // Kill existing
      const existing = services.get(name);
      if (existing?.process) { existing.status = "stopped"; existing.process.kill("SIGTERM"); await new Promise(r => setTimeout(r, 1000)); }

      // Determine source path — git clone, npx, or pre-existing path
      let svcSourcePath = sourcePath;
      let svcRuntime = rt;

      if (gitUrl) {
        // Git clone into runner's local storage
        svcSourcePath = join("/var/claudemesh/services", name);
        const { execSync } = await import("node:child_process");
        mkdirSync(svcSourcePath, { recursive: true });
        try {
          // Clean existing clone
          execSync(`rm -rf ${svcSourcePath}/*`, { timeout: 10_000 });
          execSync(`git clone --depth 1 ${gitBranch ? `--branch ${gitBranch}` : ""} ${gitUrl} .`, { cwd: svcSourcePath, timeout: 120_000, stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
          console.log(`[runner] git clone complete: ${gitUrl} -> ${svcSourcePath}`);
        } catch (e) {
          return json(res, 500, { error: `git clone failed: ${e.message}` });
        }
      } else if (npxPackage) {
        // npx-based: create a minimal package.json that depends on the package
        svcSourcePath = join("/var/claudemesh/services", name);
        mkdirSync(svcSourcePath, { recursive: true });
        const pkg = { name: `mcp-${name}`, private: true, dependencies: { [npxPackage]: "*" } };
        writeFileSync(join(svcSourcePath, "package.json"), JSON.stringify(pkg, null, 2));
        svcRuntime = svcRuntime || "node";
      } else if (body.uvxPackage) {
        // uvx-based Python MCP: install via uv and find the entry point
        svcSourcePath = join("/var/claudemesh/services", name);
        mkdirSync(svcSourcePath, { recursive: true });
        const { execSync } = await import("node:child_process");
        try {
          execSync(`uv venv ${join(svcSourcePath, ".venv")}`, { timeout: 30_000, stdio: "pipe" });
          execSync(`uv pip install --python ${join(svcSourcePath, ".venv/bin/python")} ${body.uvxPackage}`, { timeout: 120_000, stdio: "pipe" });
          console.log(`[runner] uvx package installed: ${body.uvxPackage}`);
        } catch (e) {
          return json(res, 500, { error: `uvx install failed: ${e.message}` });
        }
        // Find the MCP binary in the venv
        const venvBin = join(svcSourcePath, ".venv/bin");
        if (existsSync(venvBin)) {
          const bins = readdirSync(venvBin).filter(b => !["python", "python3", "pip", "pip3", "activate", "Activate.ps1", "activate.csh", "activate.fish", "deactivate"].includes(b) && !b.startsWith("python3."));
          const pkgShort = body.uvxPackage.split("/").pop().replace(/^@/, "");
          const match = bins.find(b => b.includes(pkgShort.replace(/-/g, ""))) || bins.find(b => b.includes("mcp")) || bins[0];
          if (match) svc._npxBin = join(venvBin, match);
        }
        svcRuntime = "python";
        // Skip normal installDeps — already installed via uv
        const svc2 = { name, sourcePath: svcSourcePath, runtime: svcRuntime, env: svcEnv || {}, process: null, pid: null, tools: [], status: "running", pending: new Map(), logs: [], restarts: 0, healthFailures: 0, _npxBin: svc?._npxBin };
        Object.assign(svc, svc2);
        services.set(name, svc);
        spawnService(svc);
        await new Promise(r => setTimeout(r, 1500));
        try {
          svc.tools = await initMcp(svc);
          console.log(`[runner] ${name} ready (uvx), ${svc.tools.length} tools`);
          return json(res, 200, { status: "running", tools: svc.tools });
        } catch (e) {
          svc.status = "failed"; svc.logs.push(`MCP init failed: ${e.message}`);
          return json(res, 500, { error: e.message, logs: svc.logs.slice(-10) });
        }
      } else if (!svcSourcePath) {
        return json(res, 400, { error: "one of sourcePath, gitUrl, or npxPackage required" });
      }

      const runtime = svcRuntime || detectRuntime(svcSourcePath);
      const svc = { name, sourcePath: svcSourcePath, runtime, env: svcEnv || {}, process: null, pid: null, tools: [], status: "installing", pending: new Map(), logs: [], restarts: 0, healthFailures: 0 };
      services.set(name, svc);

      // Install deps
      try { await installDeps(svcSourcePath, runtime); } catch (e) {
        svc.status = "failed"; svc.logs.push(`install failed: ${e.message}`);
        return json(res, 500, { error: e.message });
      }

      // For npx packages: find the binary in node_modules/.bin
      if (npxPackage) {
        const binDir = join(svcSourcePath, "node_modules", ".bin");
        if (existsSync(binDir)) {
          const bins = readdirSync(binDir).filter(b => !["node-which", "which", "semver", "resolve"].includes(b));
          // Prefer binary matching the package name
          const pkgShort = npxPackage.split("/").pop().replace(/^@/, "");
          const match = bins.find(b => b === pkgShort || b.includes(pkgShort)) || bins[0];
          if (match) {
            svc._npxBin = join(binDir, match);
            console.log(`[runner] npx binary resolved: ${match}`);
          }
        }
      }

      // Spawn + MCP handshake
      spawnService(svc);
      await new Promise(r => setTimeout(r, 1000)); // npx packages may need more startup time
      try {
        svc.tools = await initMcp(svc);
        console.log(`[runner] ${name} ready, ${svc.tools.length} tools`);
        return json(res, 200, { status: "running", tools: svc.tools });
      } catch (e) {
        svc.status = "failed"; svc.logs.push(`MCP init failed: ${e.message}`);
        return json(res, 500, { error: e.message, logs: svc.logs.slice(-10) });
      }
    }

    if (req.method === "POST" && req.url === "/call") {
      const body = await readBody(req);
      const { name, tool, args } = body;
      const svc = services.get(name);
      if (!svc) return json(res, 404, { error: `service "${name}" not found` });
      if (svc.status !== "running") return json(res, 503, { error: `service is ${svc.status}` });
      const result = await sendMcpRequest(svc, "tools/call", { name: tool, arguments: args || {} });
      return json(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/unload") {
      const body = await readBody(req);
      const { name } = body;
      const svc = services.get(name);
      if (!svc) return json(res, 404, { error: "not found" });
      svc.status = "stopped";
      if (svc.process) { svc.process.kill("SIGTERM"); await new Promise(r => setTimeout(r, 2000)); if (svc.process) svc.process.kill("SIGKILL"); }
      for (const [, p] of svc.pending) { clearTimeout(p.timer); p.resolve({ error: "unloaded" }); }
      services.delete(name);
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error("[runner] request error:", e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[runner] supervisor listening on :${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("[runner] shutting down...");
  for (const [, svc] of services) { svc.status = "stopped"; svc.process?.kill("SIGTERM"); }
  server.close(() => process.exit(0));
});
