"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@turbostarter/ui-web/button";

const POLL_INTERVAL_MS = 5000;

interface TopicMessage {
  id: string;
  senderPubkey: string;
  senderName: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
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

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const monoStyle = { fontFamily: "var(--cm-font-mono)" } as const;

export function TopicChatPanel({
  topicName,
  meshSlug,
  apiKeySecret,
  apiKeyExpiresAt,
}: Props) {
  const [messages, setMessages] = useState<TopicMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${apiKeySecret}`,
      "Content-Type": "application/json",
    }),
    [apiKeySecret],
  );

  const refresh = useCallback(async () => {
    setIsFetching(true);
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
      setMessages(json.messages.slice().reverse());
      setError(null);
      setLastPollAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsFetching(false);
    }
  }, [headers, topicName]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

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
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const secondsSincePoll = lastPollAt
    ? Math.max(0, Math.floor((Date.now() - lastPollAt) / 1000))
    : null;

  return (
    <div className="flex h-[70vh] flex-col overflow-hidden rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg)]">
      {/* Header — mono strip, clay-pulse dot, metadata right */}
      <div
        className="flex items-center justify-between border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/60 px-4 py-3"
        style={monoStyle}
      >
        <div className="flex items-center gap-3">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (isFetching
                ? "bg-[var(--cm-clay)] animate-pulse"
                : "bg-emerald-500")
            }
          />
          <span className="text-[11px] text-[var(--cm-fg-secondary)]">
            #{topicName}
          </span>
        </div>
        <span className="text-[10px] text-[var(--cm-fg-tertiary)]">
          {messages.length} msg ·{" "}
          {isFetching
            ? "polling…"
            : `${secondsSincePoll ?? "—"}s ago`}
        </span>
      </div>

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
        <span>polling every {POLL_INTERVAL_MS / 1000}s</span>
        <span>key valid until {fmtTime(apiKeyExpiresAt)}</span>
        <span className="ml-auto">
          v0.2.0 · plaintext base64 · per-topic crypto in v0.3.0
        </span>
      </div>
    </div>
  );
}
