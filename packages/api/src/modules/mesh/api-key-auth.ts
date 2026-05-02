/**
 * API key bearer-token auth for /v1/* REST endpoints (v0.2.0).
 *
 * Authorization: Bearer cm_<base64url>
 *   secret prefix → narrow candidate set by `secret_prefix` index
 *   timing-safe SHA-256 compare → identify the key
 *   capability + topic-scope checks happen at the route layer
 *
 * Spec: .artifacts/specs/2026-05-02-v0.2.0-scope.md
 */

import { createMiddleware } from "hono/factory";
import { HttpException } from "@turbostarter/shared/utils";
import { HttpStatusCode } from "@turbostarter/shared/constants";
import { db } from "@turbostarter/db/server";
import { meshApiKey } from "@turbostarter/db/schema/mesh";
import { and, eq } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";

export type ApiKeyCapability = "send" | "read" | "state_write" | "admin";

export interface AuthedApiKey {
  id: string;
  meshId: string;
  capabilities: ApiKeyCapability[];
  topicScopes: string[] | null;
}

async function verifyBearer(secret: string): Promise<AuthedApiKey | null> {
  if (!secret.startsWith("cm_")) return null;
  const prefix = secret.slice(0, 11);
  const hash = createHash("sha256").update(secret).digest("hex");
  const candidates = await db
    .select({
      id: meshApiKey.id,
      meshId: meshApiKey.meshId,
      secretHash: meshApiKey.secretHash,
      capabilities: meshApiKey.capabilities,
      topicScopes: meshApiKey.topicScopes,
      revokedAt: meshApiKey.revokedAt,
      expiresAt: meshApiKey.expiresAt,
    })
    .from(meshApiKey)
    .where(eq(meshApiKey.secretPrefix, prefix));
  const now = new Date();
  for (const c of candidates) {
    if (c.revokedAt) continue;
    if (c.expiresAt && c.expiresAt < now) continue;
    const a = Buffer.from(c.secretHash, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length) continue;
    if (!timingSafeEqual(a, b)) continue;
    void db
      .update(meshApiKey)
      .set({ lastUsedAt: now })
      .where(eq(meshApiKey.id, c.id))
      .catch(() => {});
    return {
      id: c.id,
      meshId: c.meshId,
      capabilities: (c.capabilities ?? []) as ApiKeyCapability[],
      topicScopes: c.topicScopes ?? null,
    };
  }
  return null;
}

/** Middleware: verifies the bearer token and stashes the AuthedApiKey on the
 * context as `apiKey`. Throws 401 on missing/invalid creds. Capability
 * + topic-scope enforcement is per-route. */
export const enforceApiKey = createMiddleware<{
  Variables: { apiKey: AuthedApiKey };
}>(async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) {
    throw new HttpException(HttpStatusCode.UNAUTHORIZED, {
      code: "error.api_key_missing",
    });
  }
  const key = await verifyBearer(m[1]!.trim());
  if (!key) {
    throw new HttpException(HttpStatusCode.UNAUTHORIZED, {
      code: "error.api_key_invalid",
    });
  }
  c.set("apiKey", key);
  await next();
});

/** Inline helper: assert the authed key has a capability. */
export function requireCapability(
  key: AuthedApiKey,
  cap: ApiKeyCapability,
): void {
  if (!key.capabilities.includes(cap) && !key.capabilities.includes("admin")) {
    throw new HttpException(HttpStatusCode.FORBIDDEN, {
      code: "error.api_key_missing_capability",
    });
  }
}

/** Inline helper: assert the authed key may operate on this topic name.
 * Pass topic name as it appears to users (without # prefix). */
export function requireTopicScope(key: AuthedApiKey, topicName: string): void {
  if (!key.topicScopes) return; // null = unscoped, allowed everywhere
  if (key.topicScopes.includes(topicName)) return;
  throw new HttpException(HttpStatusCode.FORBIDDEN, {
    code: "error.api_key_topic_out_of_scope",
  });
}
