/**
 * `claudemesh topic tail <name>` — live SSE consumer of a topic stream.
 * Prints the last N messages from /v1/topics/:name/messages, then opens
 * the SSE firehose at /v1/topics/:name/stream and prints new messages
 * as they arrive. Ctrl-C to exit.
 */

import { URLS } from "~/constants/urls.js";
import { withRestKey } from "~/services/api/with-rest-key.js";
import { request } from "~/services/api/client.js";
import {
  getTopicKey,
  decryptMessage,
  sealTopicKeyFor,
} from "~/services/crypto/topic-key.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim, yellow } from "~/ui/styles.js";
import { EXIT } from "~/constants/exit-codes.js";

export interface TopicTailFlags {
  mesh?: string;
  json?: boolean;
  limit?: number | string;
  /** Skip the initial backfill — only show forward messages. */
  forwardOnly?: boolean;
}

interface TopicMessage {
  id: string;
  senderMemberId?: string;
  senderPubkey: string;
  senderName: string;
  nonce: string;
  ciphertext: string;
  bodyVersion?: number;
  replyToId?: string | null;
  createdAt: string;
}

/** Bounded recent-message cache used to render reply-context lines. */
type RenderedSnippet = { name: string; snippet: string };
const RECENT_CACHE_MAX = 256;
function rememberRendered(
  cache: Map<string, RenderedSnippet>,
  m: TopicMessage,
  text: string,
): void {
  cache.set(m.id, {
    name: m.senderName || m.senderPubkey.slice(0, 8),
    snippet: text.replace(/\s+/g, " ").slice(0, 60),
  });
  if (cache.size > RECENT_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

interface HistoryResponse {
  topic: string;
  topicId: string;
  messages: TopicMessage[];
}

/**
 * v1 (legacy plaintext-base64) decode. v2 messages are decrypted via
 * the topic key separately — see decryptForRender below.
 */
function decodeV1(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "[decode failed]";
  }
}

async function decryptForRender(
  m: TopicMessage,
  topicKey: Uint8Array | null,
): Promise<string> {
  if ((m.bodyVersion ?? 1) === 1) return decodeV1(m.ciphertext);
  if (!topicKey) return "[encrypted — no topic key]";
  const plain = await decryptMessage(topicKey, m.ciphertext, m.nonce);
  return plain ?? "[decrypt failed]";
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function printMessage(
  m: TopicMessage,
  topicKey: Uint8Array | null,
  json: boolean,
  cache: Map<string, RenderedSnippet>,
): Promise<void> {
  const text = await decryptForRender(m, topicKey);
  if (json) {
    console.log(JSON.stringify({ ...m, message: text }));
    rememberRendered(cache, m, text);
    return;
  }
  const v2Marker = (m.bodyVersion ?? 1) === 2 ? dim("🔒 ") : "";
  if (m.replyToId) {
    const parent = cache.get(m.replyToId);
    const ref = parent
      ? `${parent.name}: "${parent.snippet}${parent.snippet.length === 60 ? "…" : ""}"`
      : `${m.replyToId.slice(0, 8)}…`;
    process.stdout.write(`  ${dim("↳ in reply to " + ref)}\n`);
  }
  const idTag = dim(`#${m.id.slice(0, 8)}`);
  process.stdout.write(
    `  ${dim(fmtTime(m.createdAt))}  ${bold(m.senderName || m.senderPubkey.slice(0, 8))}  ${idTag}  ${v2Marker}${text}\n`,
  );
  rememberRendered(cache, m, text);
}

interface SseEvent {
  event: string;
  id?: string;
  data: string;
}

async function* readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev: SseEvent = { event: "message", data: "" };
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const field = line.slice(0, colon);
        const val = line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") ev.event = val;
        else if (field === "id") ev.id = val;
        else if (field === "data") dataLines.push(val);
      }
      ev.data = dataLines.join("\n");
      yield ev;
    }
  }
}

export async function runTopicTail(name: string, flags: TopicTailFlags): Promise<number> {
  if (!name) {
    render.err("Usage: claudemesh topic tail <topic> [--limit N]");
    return EXIT.INVALID_ARGS;
  }
  const cleanName = name.replace(/^#/, "");
  const limit = flags.limit ? Number(flags.limit) : 20;

  return withRestKey(
    {
      meshSlug: flags.mesh ?? null,
      purpose: `tail-${cleanName}`,
      capabilities: ["read"],
      topicScopes: [cleanName],
    },
    async ({ secret, meshSlug, mesh }) => {
      // Fetch + decrypt the topic key once. Stays in memory for this
      // invocation; tail dies → key forgotten. v1 topics return
      // not_sealed/topic_unencrypted and we just don't decrypt.
      const keyResult = await getTopicKey({
        apiKeySecret: secret,
        memberSecretKeyHex: mesh.secretKey,
        topicName: cleanName,
      });
      const topicKey = keyResult.ok ? keyResult.topicKey ?? null : null;
      const snippetCache = new Map<string, RenderedSnippet>();

      // Re-seal background loop. While we hold the topic key, every
      // 30s we look for newly-joined members who don't have a sealed
      // copy yet, seal the key for each, and POST. Soft-failures stay
      // silent so a flaky network doesn't spam the tail output.
      let resealTimer: ReturnType<typeof setInterval> | null = null;
      if (topicKey) {
        const reseal = async () => {
          try {
            const pending = await request<{
              pending: Array<{
                memberId: string;
                pubkey: string;
                displayName: string;
              }>;
            }>({
              path: `/api/v1/topics/${encodeURIComponent(cleanName)}/pending-seals`,
              token: secret,
            });
            for (const target of pending.pending) {
              const sealed = await sealTopicKeyFor(
                topicKey,
                target.pubkey,
                mesh.secretKey,
              );
              if (!sealed) continue;
              try {
                await request({
                  path: `/api/v1/topics/${encodeURIComponent(cleanName)}/seal`,
                  method: "POST",
                  token: secret,
                  body: {
                    memberId: target.memberId,
                    encryptedKey: sealed.encryptedKey,
                    nonce: sealed.nonce,
                  },
                });
                if (!flags.json) {
                  render.info(
                    dim(`re-sealed topic key for ${target.displayName}`),
                  );
                }
              } catch {
                // Another holder likely sealed first — ignore.
              }
            }
          } catch {
            // Soft-fail; next tick retries.
          }
        };
        void reseal();
        resealTimer = setInterval(reseal, 30_000);
      }
      if (!flags.json && !keyResult.ok) {
        if (keyResult.error === "topic_unencrypted") {
          render.info(
            dim("topic is on v1 (plaintext) — encryption will activate after creator-seal"),
          );
        } else if (keyResult.error === "not_sealed") {
          render.warn(
            yellow(
              "no topic key sealed for you yet — wait for a holder to re-seal",
            ),
          );
        } else if (keyResult.error === "decrypt_failed") {
          render.warn(
            yellow(
              `topic key fetched but decrypt failed: ${keyResult.message ?? ""}`,
            ),
          );
        }
      }

      // 1. Backfill the most recent N messages so the user sees context
      //    when they tail an active topic.
      if (!flags.forwardOnly && limit > 0) {
        try {
          const history = await request<HistoryResponse>({
            path: `/api/v1/topics/${encodeURIComponent(cleanName)}/messages?limit=${limit}`,
            token: secret,
          });
          if (!flags.json) {
            render.section(
              `${clay("#" + cleanName)} on ${dim(meshSlug)} — backfill ${history.messages.length}, then live`,
            );
          }
          // History is newest-first; reverse for chronological display.
          for (const m of history.messages.slice().reverse()) {
            await printMessage(m, topicKey, flags.json ?? false, snippetCache);
          }
        } catch (err) {
          render.warn(`backfill failed: ${(err as Error).message}`);
        }
      }

      // 2. Open the SSE firehose. fetch + ReadableStream so the bearer
      //    stays in the Authorization header (no token-in-URL leak).
      const url = `${URLS.API_BASE}/api/v1/topics/${encodeURIComponent(cleanName)}/stream`;
      const ctl = new AbortController();
      const onSig = () => ctl.abort();
      process.once("SIGINT", onSig);
      process.once("SIGTERM", onSig);

      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${secret}` },
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) {
          render.err(`stream open failed: ${res.status}`);
          return EXIT.INTERNAL_ERROR;
        }
        if (!flags.json) {
          render.info(dim("tailing — Ctrl-C to exit"));
        }
        const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
        for await (const ev of readSseStream(reader)) {
          if (ev.event === "ready" || ev.event === "heartbeat") continue;
          if (ev.event === "error") {
            try {
              const parsed = JSON.parse(ev.data) as { error?: string };
              render.err(`stream error: ${parsed.error ?? "unknown"}`);
            } catch {
              render.err("stream error");
            }
            continue;
          }
          if (ev.event === "message") {
            try {
              const m = JSON.parse(ev.data) as TopicMessage;
              await printMessage(m, topicKey, flags.json ?? false, snippetCache);
            } catch {
              // skip malformed
            }
          }
        }
        return EXIT.SUCCESS;
      } catch (err) {
        if (ctl.signal.aborted) return EXIT.SUCCESS; // user Ctrl-C'd
        render.err(`tail aborted: ${(err as Error).message}`);
        return EXIT.INTERNAL_ERROR;
      } finally {
        process.removeListener("SIGINT", onSig);
        process.removeListener("SIGTERM", onSig);
        if (resealTimer) clearInterval(resealTimer);
      }
    },
  );
}
