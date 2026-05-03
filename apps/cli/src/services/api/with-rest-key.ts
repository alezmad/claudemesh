/**
 * Mint an ephemeral apikey via the broker WS, hand it to a REST callback,
 * and revoke on exit. Lets `notification list`, `member list`, and
 * `topic tail` reuse the v1 REST surface without making the user manage
 * their own bearer tokens.
 *
 * The key is bound to the same mesh the WS connection picked, lives for
 * 5 minutes max, and gets read-only capability + a label that makes the
 * mesh dashboard's apikey list legible. We revoke even when fn throws.
 */

import { withMesh } from "~/commands/connect.js";
import type { BrokerClient } from "~/services/broker/facade.js";
import type { JoinedMesh } from "~/services/config/facade.js";

export interface RestKeyContext {
  secret: string;
  meshId: string;
  meshSlug: string;
  client: BrokerClient;
  mesh: JoinedMesh;
}

export interface WithRestKeyOpts {
  meshSlug?: string | null;
  /** Capabilities to grant — defaults to ["read"]. */
  capabilities?: Array<"send" | "read" | "state_write" | "admin">;
  /** Topic-scope allowlist — null = all topics. */
  topicScopes?: string[] | null;
  /** Label suffix for the apikey list. */
  purpose?: string;
}

export async function withRestKey<T>(
  opts: WithRestKeyOpts,
  fn: (ctx: RestKeyContext) => Promise<T>,
): Promise<T> {
  return withMesh({ meshSlug: opts.meshSlug ?? null }, async (client, mesh) => {
    const result = await client.apiKeyCreate({
      label: `cli-${opts.purpose ?? "rest"}-${process.pid}`,
      capabilities: opts.capabilities ?? ["read"],
      topicScopes: opts.topicScopes ?? undefined,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    if (!result || !result.secret) {
      throw new Error("apikey mint failed — broker did not return a secret");
    }
    try {
      return await fn({
        secret: result.secret,
        meshId: mesh.meshId,
        meshSlug: mesh.slug,
        client,
        mesh,
      });
    } finally {
      // Best-effort cleanup. If the broker connection already closed we
      // just leak a 5-minute key — acceptable trade-off for keeping the
      // command code linear.
      try {
        await client.apiKeyRevoke(result.id);
      } catch {
        // swallow — diagnostic noise without value
      }
    }
  });
}
