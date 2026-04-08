/**
 * Service Manager — lifecycle management for mesh-deployed MCP servers.
 *
 * Each deployed MCP server runs as a child process with its own stdio pipe.
 * The manager spawns, monitors, restarts, and routes tool calls to them.
 *
 * In production: child processes run inside a Docker container (one per mesh).
 * In dev: child processes run directly on the broker host.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MCP tool definition returned by tools/list. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Per-service deploy-time configuration. */
export interface ServiceConfig {
  env?: Record<string, string>;
  memory_mb?: number;
  cpus?: number;
  network_allow?: string[];
  runtime?: "node" | "python" | "bun";
}

/** Observable lifecycle states. */
export type ServiceStatus =
  | "building"
  | "installing"
  | "running"
  | "stopped"
  | "failed"
  | "crashed"
  | "restarting";

/** Internal bookkeeping for a spawned service. */
interface ManagedService {
  name: string;
  meshId: string;
  process: ChildProcess | null;
  tools: ToolDef[];
  status: ServiceStatus;
  config: ServiceConfig;
  sourcePath: string;
  runtime: "node" | "python" | "bun";
  restartCount: number;
  maxRestarts: number;
  healthFailures: number;
  logBuffer: string[]; // ring buffer, max LOG_BUFFER_SIZE
  pendingCalls: Map<
    string,
    {
      resolve: (result: { result?: unknown; error?: string }) => void;
      timer: NodeJS.Timeout;
    }
  >;
  pid?: number;
  startedAt?: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_BUFFER_SIZE = 1000;
const HEALTH_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_HEALTH_FAILURES = 3;
const DEFAULT_MAX_RESTARTS = 5;
const CALL_TIMEOUT_MS = 25_000;
const SERVICES_BASE_DIR =
  process.env.CLAUDEMESH_SERVICES_DIR ?? "/var/claudemesh/services";

// ---------------------------------------------------------------------------
// Service registry
// ---------------------------------------------------------------------------

const services = new Map<string, ManagedService>(); // keyed by "meshId:serviceName"
let healthTimer: NodeJS.Timer | null = null;

function serviceKey(meshId: string, name: string): string {
  return `${meshId}:${name}`;
}

/** Validate service name: alphanumeric, hyphens, underscores only. No path traversal. */
const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function validateServiceName(name: string): string | null {
  if (!SAFE_NAME_RE.test(name)) {
    return "service name must be 1-64 chars, alphanumeric/hyphens/underscores, starting with alphanumeric";
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return "service name must not contain path separators";
  }
  return null; // valid
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

/**
 * Detect the runtime for a service based on its source directory contents.
 *
 * Priority: bun (lockfile/config) > node (package.json) > python
 * (pyproject.toml / requirements.txt). Falls back to node.
 */
export function detectRuntime(sourcePath: string): "node" | "python" | "bun" {
  if (
    existsSync(join(sourcePath, "bun.lockb")) ||
    existsSync(join(sourcePath, "bunfig.toml"))
  ) {
    return "bun";
  }
  if (existsSync(join(sourcePath, "package.json"))) {
    return "node";
  }
  if (
    existsSync(join(sourcePath, "pyproject.toml")) ||
    existsSync(join(sourcePath, "requirements.txt"))
  ) {
    return "python";
  }
  return "node"; // default
}

// ---------------------------------------------------------------------------
// Entry point detection
// ---------------------------------------------------------------------------

function detectEntry(
  sourcePath: string,
  runtime: "node" | "python" | "bun",
): { command: string; args: string[] } {
  if (runtime === "python") {
    if (existsSync(join(sourcePath, "requirements.txt"))) {
      for (const entry of [
        "server.py",
        "src/server.py",
        "main.py",
        "src/main.py",
      ]) {
        if (existsSync(join(sourcePath, entry))) {
          return { command: "python", args: [entry] };
        }
      }
    }
    if (existsSync(join(sourcePath, "pyproject.toml"))) {
      return { command: "python", args: ["-m", "server"] };
    }
    return { command: "python", args: ["server.py"] };
  }

  // Node / Bun
  const cmd = runtime === "bun" ? "bun" : "node";
  if (existsSync(join(sourcePath, "package.json"))) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(sourcePath, "package.json"), "utf-8"),
      );
      if (pkg.main) return { command: cmd, args: [pkg.main] };
      if (pkg.bin) {
        const bin =
          typeof pkg.bin === "string"
            ? pkg.bin
            : (Object.values(pkg.bin)[0] as string);
        if (bin) return { command: cmd, args: [bin] };
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Common entry points
  for (const entry of [
    "dist/index.js",
    "src/index.js",
    "src/index.ts",
    "index.js",
  ]) {
    if (existsSync(join(sourcePath, entry))) {
      return { command: cmd, args: [entry] };
    }
  }

  return { command: cmd, args: ["src/index.js"] };
}

// ---------------------------------------------------------------------------
// Install dependencies
// ---------------------------------------------------------------------------

/**
 * Install dependencies for a service. Resolves on success, rejects with
 * the tail of stderr on failure.
 */
export async function installDeps(
  sourcePath: string,
  runtime: "node" | "python" | "bun",
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    if (runtime === "python") {
      if (existsSync(join(sourcePath, "requirements.txt"))) {
        cmd = "pip";
        args = ["install", "--no-cache-dir", "-r", "requirements.txt"];
      } else {
        cmd = "pip";
        args = ["install", "--no-cache-dir", "."];
      }
    } else if (runtime === "bun") {
      cmd = "bun";
      args = ["install"];
    } else {
      cmd = "npm";
      args = ["install", "--production", "--legacy-peer-deps"];
    }

    const child = spawn(cmd, args, {
      cwd: sourcePath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${cmd} install failed (exit ${code}): ${stderr.slice(-500)}`,
          ),
        );
    });
    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Log ring buffer
// ---------------------------------------------------------------------------

function appendLog(svc: ManagedService, line: string): void {
  svc.logBuffer.push(`${new Date().toISOString()} ${line}`);
  if (svc.logBuffer.length > LOG_BUFFER_SIZE) {
    svc.logBuffer.shift();
  }
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC helpers
// ---------------------------------------------------------------------------

let callIdCounter = 0;

function sendMcpRequest(
  svc: ManagedService,
  method: string,
  params?: unknown,
): Promise<{ result?: unknown; error?: string }> {
  return new Promise((resolve) => {
    if (!svc.process || !svc.process.stdin?.writable) {
      resolve({ error: "service not running" });
      return;
    }

    const id = `call_${++callIdCounter}`;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };

    const timer = setTimeout(() => {
      svc.pendingCalls.delete(id);
      resolve({ error: `tool call timed out after ${CALL_TIMEOUT_MS}ms` });
    }, CALL_TIMEOUT_MS);

    svc.pendingCalls.set(id, { resolve, timer });

    try {
      svc.process.stdin!.write(JSON.stringify(request) + "\n");
    } catch (e) {
      clearTimeout(timer);
      svc.pendingCalls.delete(id);
      resolve({
        error: `write failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Initialize MCP server (handshake + tool discovery)
// ---------------------------------------------------------------------------

async function initializeMcp(svc: ManagedService): Promise<ToolDef[]> {
  // MCP initialize handshake
  const initResult = await sendMcpRequest(svc, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "claudemesh-runner", version: "0.1.0" },
  });

  if (initResult.error) {
    throw new Error(`MCP initialize failed: ${initResult.error}`);
  }

  // Send initialized notification (no response expected)
  if (svc.process?.stdin?.writable) {
    svc.process.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }) + "\n",
    );
  }

  // Fetch tool list
  const toolsResult = await sendMcpRequest(svc, "tools/list", {});
  if (toolsResult.error) {
    throw new Error(`tools/list failed: ${toolsResult.error}`);
  }

  const result = toolsResult.result as { tools?: ToolDef[] } | undefined;
  return result?.tools ?? [];
}

// ---------------------------------------------------------------------------
// Spawn an MCP server child process
// ---------------------------------------------------------------------------

function spawnService(svc: ManagedService): void {
  const { command, args } = detectEntry(svc.sourcePath, svc.runtime);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(svc.config.env ?? {}),
    NODE_ENV: "production",
  };

  const child = spawn(command, args, {
    cwd: svc.sourcePath,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  svc.process = child;
  svc.pid = child.pid;
  svc.startedAt = new Date();
  svc.status = "running";
  svc.healthFailures = 0;

  // Read MCP JSON-RPC responses from stdout
  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id && svc.pendingCalls.has(String(msg.id))) {
        const pending = svc.pendingCalls.get(String(msg.id))!;
        clearTimeout(pending.timer);
        svc.pendingCalls.delete(String(msg.id));
        if (msg.error) {
          pending.resolve({
            error: msg.error.message ?? JSON.stringify(msg.error),
          });
        } else {
          pending.resolve({ result: msg.result });
        }
      }
    } catch {
      // Not JSON — treat as log output
      appendLog(svc, `[stdout] ${line}`);
    }
  });

  // Capture stderr as logs
  const stderrRl = createInterface({ input: child.stderr! });
  stderrRl.on("line", (line) => {
    appendLog(svc, `[stderr] ${line}`);
  });

  child.on("exit", (code, signal) => {
    log.warn("service exited", {
      service: svc.name,
      mesh_id: svc.meshId,
      code,
      signal,
      restarts: svc.restartCount,
    });

    // Reject all pending calls
    for (const [, pending] of svc.pendingCalls) {
      clearTimeout(pending.timer);
      pending.resolve({ error: "service crashed" });
    }
    svc.pendingCalls.clear();
    svc.process = null;
    svc.pid = undefined;

    // Auto-restart if under limit
    if (svc.status === "running" && svc.restartCount < svc.maxRestarts) {
      svc.restartCount++;
      svc.status = "restarting";
      log.info("auto-restarting service", {
        service: svc.name,
        attempt: svc.restartCount,
      });
      setTimeout(() => spawnService(svc), 1000 * svc.restartCount); // backoff
    } else if (svc.status === "running") {
      svc.status = "crashed";
      log.error("service max restarts exceeded", {
        service: svc.name,
        restarts: svc.restartCount,
      });
    }
  });

  child.on("error", (err) => {
    log.error("service spawn error", {
      service: svc.name,
      error: err.message,
    });
    svc.status = "failed";
  });

  log.info("service spawned", {
    service: svc.name,
    mesh_id: svc.meshId,
    pid: child.pid,
    command,
    args,
    runtime: svc.runtime,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deploy (or redeploy) an MCP server.
 *
 * Installs dependencies, spawns the child process, runs the MCP
 * initialize handshake, and returns the discovered tool list.
 */
export async function deploy(opts: {
  meshId: string;
  name: string;
  sourcePath: string;
  config: ServiceConfig;
  resolvedEnv?: Record<string, string>;
}): Promise<{ tools: ToolDef[]; status: ServiceStatus }> {
  const key = serviceKey(opts.meshId, opts.name);

  // Kill existing if redeploying
  const existing = services.get(key);
  if (existing?.process) {
    existing.process.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
  }

  const runtime = opts.config.runtime ?? detectRuntime(opts.sourcePath);

  const svc: ManagedService = {
    name: opts.name,
    meshId: opts.meshId,
    process: null,
    tools: [],
    status: "installing",
    config: {
      ...opts.config,
      env: { ...(opts.config.env ?? {}), ...(opts.resolvedEnv ?? {}) },
    },
    sourcePath: opts.sourcePath,
    runtime,
    restartCount: 0,
    maxRestarts: DEFAULT_MAX_RESTARTS,
    healthFailures: 0,
    logBuffer: [],
    pendingCalls: new Map(),
  };

  services.set(key, svc);

  // Install dependencies
  try {
    await installDeps(opts.sourcePath, runtime);
  } catch (e) {
    svc.status = "failed";
    appendLog(
      svc,
      `Install failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  // Spawn and initialize
  spawnService(svc);

  // Wait a moment for the process to start
  await new Promise((r) => setTimeout(r, 500));

  // Get tool list via MCP initialize handshake
  try {
    svc.tools = await initializeMcp(svc);
    log.info("service deployed", {
      service: opts.name,
      mesh_id: opts.meshId,
      tools: svc.tools.length,
      runtime,
    });
  } catch (e) {
    svc.status = "failed";
    appendLog(
      svc,
      `MCP init failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  return { tools: svc.tools, status: svc.status };
}

/**
 * Undeploy a running service. Sends SIGTERM, waits for graceful exit
 * (up to 10 s), then SIGKILL. All pending tool calls are rejected.
 */
export async function undeploy(meshId: string, name: string): Promise<void> {
  const key = serviceKey(meshId, name);
  const svc = services.get(key);
  if (!svc) return;

  svc.status = "stopped";
  if (svc.process) {
    svc.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        svc.process?.kill("SIGKILL");
        resolve();
      }, 10_000);
      svc.process?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // Reject pending calls
  for (const [, pending] of svc.pendingCalls) {
    clearTimeout(pending.timer);
    pending.resolve({ error: "service undeployed" });
  }

  services.delete(key);
  log.info("service undeployed", { service: name, mesh_id: meshId });
}

/**
 * Route a tool call to the named service. Returns the MCP response
 * payload or an error string.
 */
export async function callTool(
  meshId: string,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result?: unknown; error?: string }> {
  const key = serviceKey(meshId, serverName);
  const svc = services.get(key);
  if (!svc) return { error: `service "${serverName}" not found` };
  if (svc.status !== "running")
    return { error: `service "${serverName}" is ${svc.status}` };
  if (!svc.process)
    return { error: `service "${serverName}" has no running process` };

  return sendMcpRequest(svc, "tools/call", { name: toolName, arguments: args });
}

/**
 * Return the last N log lines for a service (from its ring buffer).
 */
export function getLogs(meshId: string, name: string, lines = 50): string[] {
  const key = serviceKey(meshId, name);
  const svc = services.get(key);
  if (!svc) return [];
  return svc.logBuffer.slice(-Math.min(lines, LOG_BUFFER_SIZE));
}

/**
 * Return current status, PID, restart count, tool list, and uptime
 * for a single service. Returns null if the service doesn't exist.
 */
export function getStatus(
  meshId: string,
  name: string,
): {
  status: ServiceStatus;
  pid?: number;
  restartCount: number;
  tools: ToolDef[];
  startedAt?: string;
} | null {
  const key = serviceKey(meshId, name);
  const svc = services.get(key);
  if (!svc) return null;
  return {
    status: svc.status,
    pid: svc.pid,
    restartCount: svc.restartCount,
    tools: svc.tools,
    startedAt: svc.startedAt?.toISOString(),
  };
}

/**
 * Return the tool definitions for a service, or an empty array if the
 * service doesn't exist.
 */
export function getTools(meshId: string, name: string): ToolDef[] {
  const key = serviceKey(meshId, name);
  const svc = services.get(key);
  return svc?.tools ?? [];
}

/**
 * List all services belonging to a mesh with summary info.
 */
export function listServices(
  meshId: string,
): Array<{
  name: string;
  status: ServiceStatus;
  toolCount: number;
  runtime: string;
  restartCount: number;
  pid?: number;
}> {
  const result: Array<{
    name: string;
    status: ServiceStatus;
    toolCount: number;
    runtime: string;
    restartCount: number;
    pid?: number;
  }> = [];
  for (const [key, svc] of services) {
    if (!key.startsWith(`${meshId}:`)) continue;
    result.push({
      name: svc.name,
      status: svc.status,
      toolCount: svc.tools.length,
      runtime: svc.runtime,
      restartCount: svc.restartCount,
      pid: svc.pid,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Health check loop
// ---------------------------------------------------------------------------

async function healthCheckAll(): Promise<void> {
  for (const [, svc] of services) {
    if (svc.status !== "running" || !svc.process) continue;

    const result = await sendMcpRequest(svc, "ping", {});
    if (result.error) {
      svc.healthFailures++;
      log.warn("health check failed", {
        service: svc.name,
        failures: svc.healthFailures,
        error: result.error,
      });
      if (svc.healthFailures >= MAX_HEALTH_FAILURES) {
        log.error("health check threshold exceeded, restarting", {
          service: svc.name,
        });
        svc.process.kill("SIGTERM");
        // exit handler will trigger auto-restart
      }
    } else {
      svc.healthFailures = 0;
    }
  }
}

/** Start the periodic health check loop (30 s interval). No-op if already running. */
export function startHealthChecks(): void {
  if (healthTimer) return;
  healthTimer = setInterval(healthCheckAll, HEALTH_INTERVAL_MS);
}

/** Stop the periodic health check loop. */
export function stopHealthChecks(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Restore all services on broker boot
// ---------------------------------------------------------------------------

/**
 * Re-deploy every persisted service record. Called once at broker startup
 * to bring services back after a restart. Failures are logged but don't
 * prevent other services from restoring.
 */
export async function restoreAll(
  getServiceRecords: () => Promise<
    Array<{
      meshId: string;
      name: string;
      sourcePath: string;
      config: ServiceConfig;
      resolvedEnv?: Record<string, string>;
    }>
  >,
): Promise<void> {
  const records = await getServiceRecords();
  log.info("restoring services", { count: records.length });

  for (const record of records) {
    try {
      await deploy({
        meshId: record.meshId,
        name: record.name,
        sourcePath: record.sourcePath,
        config: record.config,
        resolvedEnv: record.resolvedEnv,
      });
      log.info("service restored", {
        service: record.name,
        mesh_id: record.meshId,
      });
    } catch (e) {
      log.error("service restore failed", {
        service: record.name,
        mesh_id: record.meshId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  startHealthChecks();
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/**
 * Gracefully shut down all running services. Stops health checks, sends
 * SIGTERM to every child, waits for exit, then clears the registry.
 */
export async function shutdownAll(): Promise<void> {
  stopHealthChecks();
  const promises: Promise<void>[] = [];
  for (const [, svc] of services) {
    if (svc.process) {
      svc.status = "stopped";
      promises.push(undeploy(svc.meshId, svc.name));
    }
  }
  await Promise.allSettled(promises);
  services.clear();
}
