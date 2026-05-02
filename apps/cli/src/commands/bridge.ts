/**
 * `claudemesh bridge run <config.yaml>` — long-lived process that joins
 * two meshes and forwards a single topic between them.
 *
 * The CLI doesn't link against @claudemesh/sdk to avoid a workspace
 * coupling at publish time — instead it constructs the SDK Bridge
 * inline using the same MeshClient that the rest of the CLI already
 * relies on. The bridge config file specifies broker URLs, mesh ids,
 * memberships (private keys), and the topic name on each side.
 *
 * Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
 */

import { readFileSync, existsSync } from "node:fs";
import { render } from "~/ui/render.js";
import { bold, clay, dim, green, red, yellow } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

interface BridgeConfigSide {
  broker_url: string;
  mesh_id: string;
  member_id: string;
  /** Hex-encoded ed25519 public key. */
  pubkey: string;
  /** Hex-encoded ed25519 secret key (64 bytes). */
  secret_key: string;
  topic: string;
  display_name?: string;
  role?: "lead" | "member" | "observer";
}

interface BridgeConfig {
  a: BridgeConfigSide;
  b: BridgeConfigSide;
  max_hops?: number;
}

/** Tiny YAML parser — handles the flat shape `bridge run` accepts. For
 * complex configs, callers can pass JSON (.json extension). */
function parseConfig(text: string): BridgeConfig {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as BridgeConfig;

  const root: Record<string, Record<string, unknown> | number> = {};
  let cursor: Record<string, unknown> | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;

    const top = line.match(/^(a|b)\s*:\s*$/);
    if (top) {
      cursor = {};
      root[top[1]!] = cursor;
      continue;
    }
    const flat = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (flat && /^\s/.test(line) && cursor) {
      cursor[flat[1]!] = parseScalar(flat[2]!);
    } else if (flat) {
      const v = parseScalar(flat[2]!);
      // top-level scalars (e.g. max_hops) — only number/string supported
      if (typeof v === "number") root[flat[1]!] = v;
    }
  }
  return root as unknown as BridgeConfig;
}

function parseScalar(raw: string): string | number | boolean {
  const v = raw.trim().replace(/^["'](.*)["']$/, "$1");
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export async function runBridge(configPath: string): Promise<number> {
  if (!configPath) {
    render.err("Usage: claudemesh bridge run <config.yaml>");
    return EXIT.INVALID_ARGS;
  }
  if (!existsSync(configPath)) {
    render.err(`config file not found: ${configPath}`);
    return EXIT.NOT_FOUND;
  }

  let cfg: BridgeConfig;
  try {
    cfg = parseConfig(readFileSync(configPath, "utf-8"));
  } catch (e) {
    render.err(`failed to parse ${configPath}: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.INVALID_ARGS;
  }
  if (!cfg.a || !cfg.b) {
    render.err("config must define 'a:' and 'b:' sections");
    return EXIT.INVALID_ARGS;
  }
  for (const [name, side] of [["a", cfg.a], ["b", cfg.b]] as const) {
    if (!side.broker_url || !side.mesh_id || !side.member_id || !side.pubkey || !side.secret_key || !side.topic) {
      render.err(`config side '${name}' missing required fields: broker_url, mesh_id, member_id, pubkey, secret_key, topic`);
      return EXIT.INVALID_ARGS;
    }
  }

  // Lazy-load SDK so the CLI bundle stays trim for users who never
  // bridge.
  const { Bridge } = await import("@claudemesh/sdk");

  const bridge = new Bridge({
    a: {
      client: {
        brokerUrl: cfg.a.broker_url,
        meshId: cfg.a.mesh_id,
        memberId: cfg.a.member_id,
        pubkey: cfg.a.pubkey,
        secretKey: cfg.a.secret_key,
        displayName: cfg.a.display_name ?? "bridge",
        peerType: "connector",
        channel: "bridge",
      },
      topic: cfg.a.topic,
      role: cfg.a.role,
    },
    b: {
      client: {
        brokerUrl: cfg.b.broker_url,
        meshId: cfg.b.mesh_id,
        memberId: cfg.b.member_id,
        pubkey: cfg.b.pubkey,
        secretKey: cfg.b.secret_key,
        displayName: cfg.b.display_name ?? "bridge",
        peerType: "connector",
        channel: "bridge",
      },
      topic: cfg.b.topic,
      role: cfg.b.role,
    },
    maxHops: cfg.max_hops,
  });

  bridge.on("forwarded", (e) => {
    process.stdout.write(
      `${dim(new Date().toISOString())}  ${green("→")} ${e.from}→${e.to} hop=${e.hop} ${dim(`${e.bytes}b`)}\n`,
    );
  });
  bridge.on("dropped", (e) => {
    process.stdout.write(
      `${dim(new Date().toISOString())}  ${yellow("·")} drop from=${e.from} reason=${e.reason}${e.hop >= 0 ? ` hop=${e.hop}` : ""}\n`,
    );
  });
  bridge.on("error", (e) => {
    process.stderr.write(`${red("✘")} ${e.message}\n`);
  });

  try {
    await bridge.start();
  } catch (e) {
    render.err(`bridge failed to start: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.NETWORK_ERROR;
  }

  render.ok(
    "bridge running",
    `${clay("#" + cfg.a.topic)} ${dim("⟷")} ${clay("#" + cfg.b.topic)}`,
  );
  process.stderr.write(`${dim(`  meshes: ${cfg.a.mesh_id.slice(0, 8)} ⟷ ${cfg.b.mesh_id.slice(0, 8)}  max_hops: ${cfg.max_hops ?? 2}`)}\n`);
  process.stderr.write(`${dim("  Ctrl-C to stop.")}\n\n`);

  // Keep the process alive; bridge runs forever.
  await new Promise<void>((resolve) => {
    const stop = async (): Promise<void> => {
      process.stderr.write(`\n${dim("stopping bridge...")}\n`);
      await bridge.stop();
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

  return EXIT.SUCCESS;
}

/** Generate a config skeleton for the user to fill in. */
export function bridgeConfigTemplate(): string {
  return `# claudemesh bridge config
# Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
#
# A bridge holds memberships in two meshes and forwards messages on a
# single topic between them. Loop prevention via plaintext hop counter
# (visible in message body — minor wart, fixed in v0.3.0).
#
# Tip: \`claudemesh peer verify\` shows the keys/ids you need below.

max_hops: 2

a:
  broker_url: wss://ic.claudemesh.com/ws
  mesh_id: <mesh A id>
  member_id: <bridge member id in mesh A>
  pubkey: <ed25519 public key hex, 32 bytes>
  secret_key: <ed25519 secret key hex, 64 bytes>
  topic: incidents
  display_name: bridge
  role: member

b:
  broker_url: wss://ic.claudemesh.com/ws
  mesh_id: <mesh B id>
  member_id: <bridge member id in mesh B>
  pubkey: <ed25519 public key hex>
  secret_key: <ed25519 secret key hex>
  topic: incidents
`;
}
