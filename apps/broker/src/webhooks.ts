/**
 * Inbound webhook handler.
 *
 * External services POST JSON to `/hook/:meshId/:secret`. The broker
 * verifies the secret against the mesh.webhook table, then pushes the
 * payload to all connected peers in that mesh as a "webhook" push.
 */

import { eq, and } from "drizzle-orm";
import { db } from "./db";
import { meshWebhook } from "@turbostarter/db/schema/mesh";
import type { WSPushMessage } from "./types";
import { log } from "./logger";

export interface WebhookResult {
  status: number;
  body: { ok: boolean; delivered?: number; error?: string };
}

/**
 * Look up a webhook by meshId + secret, verify it's active, then return
 * the webhook name for push routing. Returns null if not found/inactive.
 */
async function findActiveWebhook(
  meshId: string,
  secret: string,
): Promise<{ id: string; name: string; meshId: string } | null> {
  const rows = await db
    .select({ id: meshWebhook.id, name: meshWebhook.name, meshId: meshWebhook.meshId })
    .from(meshWebhook)
    .where(
      and(
        eq(meshWebhook.meshId, meshId),
        eq(meshWebhook.secret, secret),
        eq(meshWebhook.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Handle an inbound webhook HTTP request.
 *
 * @param meshId - mesh ID from the URL path
 * @param secret - webhook secret from the URL path
 * @param body - parsed JSON body from the request
 * @param broadcastToMesh - callback to push a message to all connected peers in a mesh.
 *   Returns the number of peers the message was delivered to.
 */
export async function handleWebhook(
  meshId: string,
  secret: string,
  body: unknown,
  broadcastToMesh: (meshId: string, msg: WSPushMessage) => number,
): Promise<WebhookResult> {
  try {
    const webhook = await findActiveWebhook(meshId, secret);
    if (!webhook) {
      log.warn("webhook auth failed", { mesh_id: meshId });
      return { status: 401, body: { ok: false, error: "unauthorized" } };
    }

    if (body === null || body === undefined || typeof body !== "object") {
      return { status: 400, body: { ok: false, error: "invalid JSON body" } };
    }

    const pushMsg: WSPushMessage = {
      type: "push",
      subtype: "webhook" as any,
      event: webhook.name,
      eventData: body as Record<string, unknown>,
      messageId: crypto.randomUUID(),
      meshId: webhook.meshId,
      senderPubkey: `webhook:${webhook.name}`,
      priority: "next",
      nonce: "",
      ciphertext: "",
      createdAt: new Date().toISOString(),
    };

    const delivered = broadcastToMesh(webhook.meshId, pushMsg);

    log.info("webhook delivered", {
      webhook_name: webhook.name,
      mesh_id: webhook.meshId,
      delivered,
    });

    return { status: 200, body: { ok: true, delivered } };
  } catch (e) {
    log.error("webhook handler error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { status: 500, body: { ok: false, error: "internal error" } };
  }
}
