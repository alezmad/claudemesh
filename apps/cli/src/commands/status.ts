/**
 * `claudemesh status` — one-shot health report.
 *
 * Reports CLI version, config path + permissions, each joined mesh
 * with broker reachability (WS handshake probe). Exit 0 if every
 * mesh's broker is reachable, 1 otherwise.
 */

import { statSync, existsSync } from "node:fs";
import WebSocket from "ws";
import { readConfig, getConfigPath } from "~/services/config/facade.js";
import { VERSION } from "~/constants/urls.js";
import { render } from "~/ui/render.js";

interface MeshStatus {
  slug: string;
  brokerUrl: string;
  pubkey: string;
  reachable: boolean;
  error?: string;
  latencyMs?: number;
}

async function probeBroker(url: string, timeoutMs = 4000): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* noop */ }
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      const latency = Date.now() - started;
      try { ws.close(); } catch { /* noop */ }
      resolve({ ok: true, latencyMs: latency });
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

export async function runStatus(): Promise<void> {
  render.section(`status (v${VERSION})`);

  const configPath = getConfigPath();
  let configPermsNote = "missing";
  if (existsSync(configPath)) {
    const mode = (statSync(configPath).mode & 0o777).toString(8).padStart(4, "0");
    configPermsNote = mode === "0600" ? `${mode}` : `${mode} — expected 0600`;
  }
  render.kv([["config", configPath], ["perms", configPermsNote]]);

  const config = readConfig();
  if (config.meshes.length === 0) {
    render.blank();
    render.info("No meshes joined.");
    render.hint("claudemesh <invite-url>    # join + launch");
    process.exit(0);
  }

  render.blank();
  render.heading(`meshes (${config.meshes.length})`);

  const results: MeshStatus[] = [];
  for (const m of config.meshes) {
    const probe = await probeBroker(m.brokerUrl);
    const entry: MeshStatus = {
      slug: m.slug,
      brokerUrl: m.brokerUrl,
      pubkey: m.pubkey,
      reachable: probe.ok,
      error: probe.error,
      latencyMs: probe.latencyMs,
    };
    results.push(entry);
    if (probe.ok) {
      render.ok(`${m.slug}`, `${probe.latencyMs}ms → ${m.brokerUrl}`);
    } else {
      render.err(`${m.slug}`, `unreachable (${probe.error})`);
    }
  }

  render.blank();
  for (const r of results) {
    render.kv([[r.slug, `${r.pubkey.slice(0, 16)}…`]]);
  }

  const allOk = results.every((r) => r.reachable);
  render.blank();
  if (allOk) {
    render.ok("all meshes reachable");
    process.exit(0);
  } else {
    const broken = results.filter((r) => !r.reachable).length;
    render.err(`${broken} of ${results.length} mesh(es) unreachable`);
    process.exit(1);
  }
}
