"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@turbostarter/ui-web/button";

interface TopicMessage {
  id: string;
  senderPubkey: string;
  senderName: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
}

interface MeshMember {
  memberId: string;
  pubkey: string;
  displayName: string;
  role: string;
  isHuman: boolean;
  joinedAt: string;
  online: boolean;
  status: string;
  summary: string | null;
}

interface Props {
  topicName: string;
  topicId: string;
  meshSlug: string;
  apiKeySecret: string;
  apiKeyExpiresAt: string;
}

/**
 * Encode plaintext into the broker's wire format. v0.2.0 uses base64
 * plaintext in the `ciphertext` field — real per-topic symmetric keys
 * land in v0.3.0. Same applies to the random nonce: it satisfies the
 * schema but isn't cryptographically meaningful yet.
 */
function encodeOutgoing(plaintext: string): { ciphertext: string; nonce: string } {
  const bytes = new TextEncoder().encode(plaintext);
  const ciphertext =
    typeof window === "undefined"
      ? Buffer.from(bytes).toString("base64")
      : btoa(String.fromCharCode(...bytes));
  const nonceBytes = new Uint8Array(24);
  crypto.getRandomValues(nonceBytes);
  const nonce =
    typeof window === "undefined"
      ? Buffer.from(nonceBytes).toString("base64")
      : btoa(String.fromCharCode(...nonceBytes));
  return { ciphertext, nonce };
}

function decodeIncoming(ciphertext: string): string {
  try {
    const decoded =
      typeof window === "undefined"
        ? Buffer.from(ciphertext, "base64").toString("utf-8")
        : new TextDecoder().decode(
            Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0)),
          );
    return decoded;
  } catch {
    return "[decode failed]";
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const monoStyle = { fontFamily: "var(--cm-font-mono)" } as const;

type SseEvent = {
  event: string;
  id?: string;
  data: string;
};

/**
 * Minimal text/event-stream parser. Reads from a `fetch` body so we can
 * keep the bearer token in the Authorization header — the native
 * EventSource API doesn't allow custom headers, which would force us to
 * pass the secret via query string and leak it into proxy/referer logs.
 *
 * Yields each `event:`/`id:`/`data:` block. Anything that doesn't fit
 * the format (comments, blank lines, unknown fields) is skipped.
 */
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

export function TopicChatPanel({
  topicName,
  meshSlug,
  apiKeySecret,
  apiKeyExpiresAt,
}: Props) {
  const [messages, setMessages] = useState<TopicMessage[]>([]);
  const [members, setMembers] = useState<MeshMember[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [streamState, setStreamState] = useState<
    "connecting" | "live" | "reconnecting" | "stopped"
  >("connecting");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastMarkReadAtRef = useRef<number>(0);

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${apiKeySecret}`,
      "Content-Type": "application/json",
    }),
    [apiKeySecret],
  );

  // Mark the topic read up to now, but at most once per 5 seconds —
  // we'd otherwise hit /read on every inbound SSE message which is
  // wasteful (the wall-clock watermark advances either way).
  const markRead = useCallback(async () => {
    if (Date.now() - lastMarkReadAtRef.current < 5000) return;
    lastMarkReadAtRef.current = Date.now();
    try {
      await fetch(`/api/v1/topics/${encodeURIComponent(topicName)}/read`, {
        method: "PATCH",
        headers,
      });
    } catch {
      // Soft-fail — unread counts are advisory.
    }
  }, [headers, topicName]);

  // One-shot history backfill on mount; the SSE stream is forward-only,
  // so any messages older than connect-time come from this fetch.
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/topics/${encodeURIComponent(topicName)}/messages?limit=100`,
        { headers, cache: "no-store" },
      );
      if (!res.ok) {
        setError(`history fetch failed: ${res.status}`);
        return;
      }
      const json = (await res.json()) as { messages: TopicMessage[] };
      const ordered = json.messages.slice().reverse();
      for (const m of ordered) seenIdsRef.current.add(m.id);
      setMessages(ordered);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [headers, topicName]);

  useEffect(() => {
    void loadHistory();
    void markRead();
  }, [loadHistory, markRead]);

  // Roster — refresh every 20s so online state stays roughly current.
  // Tighter cadence isn't worth a dedicated SSE channel for v1.6.x.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/members", {
          headers,
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { members: MeshMember[] };
        if (!cancelled) setMembers(json.members);
      } catch {
        // Soft-fail — sidebar will just show whatever we last had.
      }
    };
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [headers]);

  // SSE subscription with auto-reconnect. AbortController unwinds the
  // stream when the component unmounts or the topic/key changes.
  useEffect(() => {
    const ctl = new AbortController();
    let cancelled = false;
    let backoffMs = 1000;

    const run = async () => {
      while (!cancelled) {
        try {
          setStreamState((prev) =>
            prev === "live" ? "reconnecting" : "connecting",
          );
          const res = await fetch(
            `/api/v1/topics/${encodeURIComponent(topicName)}/stream`,
            {
              headers: { Authorization: `Bearer ${apiKeySecret}` },
              signal: ctl.signal,
              cache: "no-store",
            },
          );
          if (!res.ok || !res.body) {
            throw new Error(`stream open failed: ${res.status}`);
          }
          backoffMs = 1000;
          setStreamState("live");
          const reader = res.body.getReader();
          for await (const ev of readSseStream(reader)) {
            setLastEventAt(Date.now());
            if (ev.event === "ready") continue;
            if (ev.event === "heartbeat") continue;
            if (ev.event === "error") {
              try {
                const parsed = JSON.parse(ev.data) as { error?: string };
                setError(parsed.error ?? "stream error");
              } catch {
                setError("stream error");
              }
              continue;
            }
            if (ev.event === "message") {
              try {
                const m = JSON.parse(ev.data) as TopicMessage;
                if (seenIdsRef.current.has(m.id)) continue;
                seenIdsRef.current.add(m.id);
                setMessages((cur) => [...cur, m]);
                void markRead();
              } catch {
                // Drop malformed events silently — heartbeat-as-message
                // happens once per misconfigured proxy.
              }
            }
          }
          // Reader exhausted (server closed) — loop will reconnect.
        } catch (e) {
          if (cancelled || ctl.signal.aborted) return;
          setError(`stream: ${(e as Error).message}`);
        }
        if (cancelled) return;
        setStreamState("reconnecting");
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 15_000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      setStreamState("stopped");
      ctl.abort();
    };
  }, [apiKeySecret, topicName, markRead]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      const { ciphertext, nonce } = encodeOutgoing(text);
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({ topic: topicName, ciphertext, nonce }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setError(`send failed: ${res.status} ${body}`);
        return;
      }
      setDraft("");
      // SSE stream will deliver the message back; no manual refresh.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const secondsSinceEvent = lastEventAt
    ? Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000))
    : null;

  const dotClass =
    streamState === "live"
      ? "bg-emerald-500"
      : streamState === "stopped"
        ? "bg-[var(--cm-fg-tertiary)]"
        : "bg-[var(--cm-clay)] animate-pulse";

  const stateLabel =
    streamState === "live"
      ? `live · ${secondsSinceEvent ?? 0}s`
      : streamState === "connecting"
        ? "connecting…"
        : streamState === "reconnecting"
          ? "reconnecting…"
          : "stopped";

  const onlineCount = members.filter((m) => m.online).length;

  return (
    <div className="flex h-[70vh] flex-col overflow-hidden rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg)]">
      {/* Header — mono strip, clay-pulse dot, metadata right */}
      <div
        className="flex items-center justify-between border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/60 px-4 py-3"
        style={monoStyle}
      >
        <div className="flex items-center gap-3">
          <span className={"inline-block h-2 w-2 rounded-full " + dotClass} />
          <span className="text-[11px] text-[var(--cm-fg-secondary)]">
            #{topicName}
          </span>
        </div>
        <span className="text-[10px] text-[var(--cm-fg-tertiary)]">
          {messages.length} msg · {stateLabel}
        </span>
      </div>

      {/* Body — message stream + member sidebar */}
      <div className="flex flex-1 overflow-hidden">
      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p
            className="py-12 text-center text-[11px] text-[var(--cm-fg-tertiary)]"
            style={monoStyle}
          >
            no envelopes on this topic yet
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-1">
                <div
                  className="flex items-baseline gap-2 text-[10px]"
                  style={monoStyle}
                >
                  <span className="text-[var(--cm-fg)] font-medium">
                    {m.senderName || m.senderPubkey.slice(0, 8)}
                  </span>
                  <span className="text-[var(--cm-fg-tertiary)]">
                    {m.senderPubkey.slice(0, 8)}
                  </span>
                  <span className="text-[var(--cm-fg-tertiary)]">
                    {fmtTime(m.createdAt)}
                  </span>
                </div>
                <p className="text-[var(--cm-fg)] text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {decodeIncoming(m.ciphertext)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Member sidebar — roster with online dot */}
      <aside className="hidden w-[180px] shrink-0 flex-col border-l border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30 lg:flex">
        <div
          className="border-b border-[var(--cm-border)] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[var(--cm-fg-tertiary)]"
          style={monoStyle}
        >
          {onlineCount}/{members.length} online
        </div>
        <ol className="flex-1 overflow-y-auto py-2">
          {members.length === 0 ? (
            <li
              className="px-3 py-4 text-center text-[10px] text-[var(--cm-fg-tertiary)]"
              style={monoStyle}
            >
              loading…
            </li>
          ) : (
            <>
              {members.filter((m) => m.online).map((m) => (
                <li
                  key={m.memberId}
                  className="group flex items-center gap-2 px-3 py-1.5"
                  title={m.summary ?? `${m.role} · ${m.pubkey.slice(0, 12)}…`}
                >
                  <span
                    className={
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full " +
                      (m.status === "dnd"
                        ? "bg-[#c46686]"
                        : m.status === "working"
                          ? "bg-[var(--cm-clay)]"
                          : "bg-emerald-500")
                    }
                  />
                  <span
                    className="truncate text-[11px] text-[var(--cm-fg)]"
                    style={monoStyle}
                  >
                    {m.displayName}
                  </span>
                  {!m.isHuman ? (
                    <span
                      className="text-[8px] uppercase tracking-[0.1em] text-[var(--cm-fg-tertiary)]"
                      style={monoStyle}
                    >
                      bot
                    </span>
                  ) : null}
                </li>
              ))}
              {onlineCount > 0 && onlineCount < members.length ? (
                <li
                  className="mt-3 border-t border-[var(--cm-border)] px-3 pb-1 pt-3 text-[9px] uppercase tracking-[0.14em] text-[var(--cm-fg-tertiary)]"
                  style={monoStyle}
                >
                  offline · {members.length - onlineCount}
                </li>
              ) : null}
              {members.filter((m) => !m.online).map((m) => (
                <li
                  key={m.memberId}
                  className="flex items-center gap-2 px-3 py-1.5 opacity-50"
                  title={`${m.role} · ${m.pubkey.slice(0, 12)}…`}
                >
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cm-fg-tertiary)]" />
                  <span
                    className="truncate text-[11px] text-[var(--cm-fg-secondary)]"
                    style={monoStyle}
                  >
                    {m.displayName}
                  </span>
                  {!m.isHuman ? (
                    <span
                      className="text-[8px] uppercase tracking-[0.1em] text-[var(--cm-fg-tertiary)]"
                      style={monoStyle}
                    >
                      bot
                    </span>
                  ) : null}
                </li>
              ))}
            </>
          )}
        </ol>
      </aside>
      </div>

      {/* Compose */}
      <div className="border-t border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30 p-3">
        {error ? (
          <p
            className="mb-2 text-[10px] text-[#c46686]"
            style={monoStyle}
          >
            error · {error}
          </p>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`message #${topicName}…`}
            rows={1}
            className="flex-1 resize-none rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-3 py-2 text-sm text-[var(--cm-fg)] placeholder:text-[var(--cm-fg-tertiary)] focus:border-[var(--cm-border-hover)] focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button type="submit" disabled={sending || !draft.trim()}>
            {sending ? "…" : "send"}
          </Button>
        </form>
      </div>

      {/* Status footer — 9px mono, matches peer-graph + state-timeline footers */}
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30 px-4 py-2 text-[9px] text-[var(--cm-fg-tertiary)]"
        style={monoStyle}
      >
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--cm-clay)]" />
          mesh · {meshSlug}
        </span>
        <span>SSE · 2s push</span>
        <span>key valid until {fmtTime(apiKeyExpiresAt)}</span>
        <span className="ml-auto">
          v0.2.0 · plaintext base64 · per-topic crypto in v0.3.0
        </span>
      </div>
    </div>
  );
}
