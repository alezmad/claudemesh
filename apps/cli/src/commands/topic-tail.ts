/**
 * `claudemesh topic tail <name>` — live SSE consumer of a topic stream.
 * Prints the last N messages from /v1/topics/:name/messages, then opens
 * the SSE firehose at /v1/topics/:name/stream and prints new messages
 * as they arrive. Ctrl-C to exit.
 */

import { URLS } from "~/constants/urls.js";
import { withRestKey } from "~/services/api/with-rest-key.js";
import { request } from "~/services/api/client.js";
import { render } from "~/ui/render.js";
import { bold, clay, dim } from "~/ui/styles.js";
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
  senderPubkey: string;
  senderName: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
}

interface HistoryResponse {
  topic: string;
  topicId: string;
  messages: TopicMessage[];
}

function decodeCiphertext(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "[decode failed]";
  }
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

function printMessage(m: TopicMessage, json: boolean): void {
  const text = decodeCiphertext(m.ciphertext);
  if (json) {
    console.log(JSON.stringify({ ...m, message: text }));
    return;
  }
  process.stdout.write(
    `  ${dim(fmtTime(m.createdAt))}  ${bold(m.senderName || m.senderPubkey.slice(0, 8))}  ${text}\n`,
  );
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
    async ({ secret, meshSlug }) => {
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
            printMessage(m, flags.json ?? false);
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
              printMessage(m, flags.json ?? false);
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
      }
    },
  );
}
