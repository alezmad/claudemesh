import { Hono } from "hono";

import { count, isNull } from "@turbostarter/db";
import { mesh, messageQueue, presence } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

/**
 * Unauthed public stats for the landing page counter.
 *
 * In-memory 60s cache. Results are aggregate counts only — no ids,
 * no names, no ciphertext, no routing metadata. Safe for public consumption.
 */
const CACHE_TTL_MS = 60_000;

interface PublicStats {
  messagesRouted: number;
  meshesCreated: number;
  peersActive: number;
  lastUpdated: string;
}

let cachedStats: { value: PublicStats; expiresAt: number } | null = null;

const fetchStats = async (): Promise<PublicStats> => {
  const [[messagesRouted], [meshesCreated], [peersActive]] = await Promise.all([
    db.select({ c: count() }).from(messageQueue),
    db
      .select({ c: count() })
      .from(mesh)
      .where(isNull(mesh.archivedAt)),
    db
      .select({ c: count() })
      .from(presence)
      .where(isNull(presence.disconnectedAt)),
  ]);

  return {
    messagesRouted: messagesRouted?.c ?? 0,
    meshesCreated: meshesCreated?.c ?? 0,
    peersActive: peersActive?.c ?? 0,
    lastUpdated: new Date().toISOString(),
  };
};

export const publicRouter = new Hono().get("/stats", async (c) => {
  const now = Date.now();
  if (cachedStats && cachedStats.expiresAt > now) {
    c.header("x-cache", "HIT");
    return c.json(cachedStats.value);
  }

  const value = await fetchStats();
  cachedStats = { value, expiresAt: now + CACHE_TTL_MS };
  c.header("x-cache", "MISS");
  c.header("cache-control", "public, max-age=60, s-maxage=60");
  return c.json(value);
});
