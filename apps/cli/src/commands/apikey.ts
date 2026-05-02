/**
 * `claudemesh apikey <verb>` — manage REST + external WS bearer tokens.
 *
 * The plaintext secret is shown ONCE on creation and never returned
 * again — there's no recovery, only revoke + re-issue. Capabilities
 * (send/read/state_write/admin) and topic scopes constrain what the key
 * can do; a CI bot key with `--cap send,read --topic deploys` can only
 * post and read on `#deploys`, never the whole mesh.
 *
 * Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
 */

import { withMesh } from "./connect.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim, green, red, yellow } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

type Capability = "send" | "read" | "state_write" | "admin";

export interface ApiKeyFlags {
  mesh?: string;
  json?: boolean;
  /** Comma-separated capabilities: send,read,state_write,admin */
  cap?: string;
  /** Comma-separated topic names (without #) — empty = all topics */
  topic?: string;
  /** ISO 8601 expiry timestamp */
  expires?: string;
}

function parseCapabilities(raw?: string): Capability[] {
  if (!raw) return ["send", "read"]; // sensible default
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const valid = new Set<Capability>(["send", "read", "state_write", "admin"]);
  return parts.filter((p): p is Capability => valid.has(p as Capability));
}

export async function runApiKeyCreate(label: string, flags: ApiKeyFlags): Promise<number> {
  if (!label) {
    render.err("Usage: claudemesh apikey create <label> [--cap send,read] [--topic deploys]");
    return EXIT.INVALID_ARGS;
  }
  const caps = parseCapabilities(flags.cap);
  if (caps.length === 0) {
    render.err("at least one capability required: --cap send,read,state_write,admin");
    return EXIT.INVALID_ARGS;
  }
  const topicScopes = flags.topic
    ? flags.topic.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const result = await client.apiKeyCreate({
      label,
      capabilities: caps,
      topicScopes,
      expiresAt: flags.expires,
    });
    if (!result) {
      render.err("apikey create failed");
      return EXIT.INTERNAL_ERROR;
    }

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return EXIT.SUCCESS;
    }

    render.ok("created", `${bold(result.label)} ${dim(result.id.slice(0, 8))}`);
    process.stdout.write(`\n  ${yellow("⚠ secret shown once — copy it now:")}\n\n`);
    process.stdout.write(`  ${green(result.secret)}\n\n`);
    process.stdout.write(`  ${dim(`capabilities: ${result.capabilities.join(", ")}`)}\n`);
    if (result.topicScopes?.length) {
      process.stdout.write(`  ${dim(`topics: ${result.topicScopes.map((t) => "#" + t).join(", ")}`)}\n`);
    } else {
      process.stdout.write(`  ${dim("topics: all (no scope)")}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runApiKeyList(flags: ApiKeyFlags): Promise<number> {
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const keys = await client.apiKeyList();
    if (flags.json) {
      console.log(JSON.stringify(keys, null, 2));
      return EXIT.SUCCESS;
    }
    if (keys.length === 0) {
      render.info(dim("no api keys in this mesh."));
      return EXIT.SUCCESS;
    }
    render.section(`api keys (${keys.length})`);
    for (const k of keys) {
      const status = k.revokedAt
        ? red("revoked")
        : k.expiresAt && new Date(k.expiresAt) < new Date()
          ? yellow("expired")
          : green("active");
      const lastUsed = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never";
      const scope = k.topicScopes?.length ? k.topicScopes.map((t) => "#" + t).join(",") : "all topics";
      process.stdout.write(`  ${bold(k.label)}  ${status}  ${dim(k.id.slice(0, 8))}\n`);
      process.stdout.write(`    ${dim(`${k.prefix}…  caps: ${k.capabilities.join(",")}  scope: ${scope}  last_used: ${lastUsed}`)}\n`);
    }
    return EXIT.SUCCESS;
  });
}

export async function runApiKeyRevoke(id: string, flags: ApiKeyFlags): Promise<number> {
  if (!id) {
    render.err("Usage: claudemesh apikey revoke <id>");
    return EXIT.INVALID_ARGS;
  }
  return await withMesh({ meshSlug: flags.mesh ?? null }, async (client) => {
    const result = await client.apiKeyRevoke(id);
    if (!result.ok) {
      if (flags.json) {
        console.log(JSON.stringify({ ok: false, code: result.code, message: result.message }));
      } else {
        render.err(`${result.code}: ${result.message}`);
      }
      return result.code === "not_found"
        ? EXIT.NOT_FOUND
        : result.code === "not_unique"
          ? EXIT.INVALID_ARGS
          : EXIT.INTERNAL_ERROR;
    }
    if (flags.json) console.log(JSON.stringify({ revoked: result.id }));
    else render.ok("revoked", clay(result.id.slice(0, 8)));
    return EXIT.SUCCESS;
  });
}
