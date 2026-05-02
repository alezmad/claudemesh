/**
 * `claudemesh seed-test-mesh` — dev-only helper for 15b testing.
 *
 * Writes a locally-valid JoinedMesh entry to ~/.claudemesh/config.json
 * so the MCP server can connect to a locally-running broker without
 * invite-link / crypto plumbing.
 *
 * Usage:
 *   claudemesh seed-test-mesh <broker-url> <mesh-id> <member-id> <pubkey> <slug>
 */

import { readConfig, writeConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { bold, dim } from "~/ui/styles.js";

export function runSeedTestMesh(args: string[]): void {
  const [brokerUrl, meshId, memberId, pubkey, slug] = args;
  if (!brokerUrl || !meshId || !memberId || !pubkey || !slug) {
    render.err("Usage: claudemesh seed-test-mesh <broker-ws-url> <mesh-id> <member-id> <pubkey> <slug>");
    render.info(dim('Example: claudemesh seed-test-mesh "ws://localhost:7900/ws" mesh-123 member-abc aaa..aaa smoke-test'));
    process.exit(1);
  }
  const config = readConfig();
  config.meshes = config.meshes.filter((m) => m.slug !== slug);
  config.meshes.push({
    meshId,
    memberId,
    slug,
    name: `Test: ${slug}`,
    pubkey,
    secretKey: "dev-only-stub",
    brokerUrl,
    joinedAt: new Date().toISOString(),
  });
  writeConfig(config);
  render.ok(`seeded ${bold(slug)}`, dim(meshId));
  render.hint(`run ${bold("claudemesh mcp")} to connect, or register with Claude Code via ${bold("claudemesh install")}`);
}
