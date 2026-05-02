/**
 * `claudemesh topic post <name> <message>` — REST-encrypted send.
 *
 * Distinct from `claudemesh topic send` (WS-based, currently v1
 * plaintext). This verb:
 *   1. Mints an ephemeral REST apikey scoped to the topic.
 *   2. Fetches + decrypts the topic key (crypto_box).
 *   3. Encrypts the body with crypto_secretbox under the topic key.
 *   4. POSTs body_version: 2 ciphertext to /api/v1/messages.
 *   5. Revokes the apikey.
 *
 * If the topic doesn't yet have a sealed key for this member (404
 * not_sealed) we surface a clear error and skip — the user must wait
 * for a holder to re-seal.
 */

import { withRestKey } from "~/services/api/with-rest-key.js";
import { request } from "~/services/api/client.js";
import {
  getTopicKey,
  encryptMessage,
} from "~/services/crypto/topic-key.js";
import { render } from "~/ui/render.js";
import { clay, dim, green } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export interface TopicPostFlags {
  mesh?: string;
  json?: boolean;
  /** Force v1 plaintext send even if the topic is encrypted. */
  plaintext?: boolean;
  /** Reply-to message id (full or 8+ char prefix). */
  replyTo?: string;
}

interface PostResponse {
  messageId: string | null;
  historyId: string | null;
  topic: string;
  topicId: string;
  notifications: number;
  replyToId?: string | null;
}

export async function runTopicPost(
  topicName: string,
  message: string,
  flags: TopicPostFlags,
): Promise<number> {
  if (!topicName || !message) {
    render.err("Usage: claudemesh topic post <topic> <message>");
    return EXIT.INVALID_ARGS;
  }
  const cleanName = topicName.replace(/^#/, "");

  // Extract @-mention tokens for write-time fan-out so the server can
  // populate notifications without reading ciphertext.
  const mentions: string[] = [];
  const mentionRe = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]{1,64})(?=$|[^A-Za-z0-9_-])/g;
  let m: RegExpExecArray | null;
  while ((m = mentionRe.exec(message)) !== null) {
    mentions.push(m[2]!.toLowerCase());
    if (mentions.length >= 16) break;
  }

  return withRestKey(
    {
      meshSlug: flags.mesh ?? null,
      purpose: `post-${cleanName}`,
      capabilities: ["read", "send"],
      topicScopes: [cleanName],
    },
    async ({ secret, mesh }) => {
      let bodyVersion: 1 | 2 = 1;
      let ciphertext: string;
      let nonce: string;

      if (flags.plaintext) {
        // Explicit v1: caller wants plaintext. Encode UTF-8 → base64.
        ciphertext = Buffer.from(message, "utf-8").toString("base64");
        nonce = Buffer.from(new Uint8Array(24)).toString("base64");
      } else {
        const keyResult = await getTopicKey({
          apiKeySecret: secret,
          memberSecretKeyHex: mesh.secretKey,
          topicName: cleanName,
        });
        if (keyResult.ok && keyResult.topicKey) {
          const enc = await encryptMessage(keyResult.topicKey, message);
          ciphertext = enc.ciphertext;
          nonce = enc.nonce;
          bodyVersion = 2;
        } else if (keyResult.error === "topic_unencrypted") {
          // Legacy v0.2.0 topic — fall back to v1 plaintext.
          ciphertext = Buffer.from(message, "utf-8").toString("base64");
          nonce = Buffer.from(new Uint8Array(24)).toString("base64");
        } else {
          render.err(
            `cannot encrypt for #${cleanName}: ${keyResult.error ?? "unknown"}${
              keyResult.message ? " — " + keyResult.message : ""
            }`,
          );
          return EXIT.INTERNAL_ERROR;
        }
      }

      // Resolve reply-to: accept full id or 8+ char prefix by querying recent
      // history once and matching. Server validates same-topic membership.
      let replyToId: string | undefined;
      if (flags.replyTo) {
        if (flags.replyTo.length >= 16) {
          replyToId = flags.replyTo;
        } else if (flags.replyTo.length >= 6) {
          const recent = await request<{
            messages: Array<{ id: string }>;
          }>({
            path: `/api/v1/topics/${encodeURIComponent(cleanName)}/messages?limit=200`,
            method: "GET",
            token: secret,
          });
          const hit = recent.messages?.find((r) =>
            r.id.startsWith(flags.replyTo!),
          );
          if (!hit) {
            render.err(
              `--reply-to ${flags.replyTo}: no recent message id starts with that prefix`,
            );
            return EXIT.INVALID_ARGS;
          }
          replyToId = hit.id;
        } else {
          render.err("--reply-to needs at least 6 characters of the message id");
          return EXIT.INVALID_ARGS;
        }
      }

      const result = await request<PostResponse>({
        path: "/api/v1/messages",
        method: "POST",
        token: secret,
        body: {
          topic: cleanName,
          ciphertext,
          nonce,
          bodyVersion,
          ...(mentions.length > 0 ? { mentions } : {}),
          ...(replyToId ? { replyToId } : {}),
        },
      });

      if (flags.json) {
        console.log(JSON.stringify({ ...result, bodyVersion, mentions }));
        return EXIT.SUCCESS;
      }

      const versionTag = bodyVersion === 2 ? green("🔒 v2") : dim("v1");
      const replyTag = result.replyToId
        ? `  ${dim("↳ " + result.replyToId.slice(0, 8))}`
        : "";
      render.ok(
        "posted",
        `${clay("#" + cleanName)}  ${versionTag}${replyTag}  ${dim(`(${result.notifications} mentions)`)}`,
      );
      return EXIT.SUCCESS;
    },
  );
}
