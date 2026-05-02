"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@turbostarter/ui-web/badge";
import { Button } from "@turbostarter/ui-web/button";
import { Card, CardContent, CardHeader, CardTitle } from "@turbostarter/ui-web/card";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${apiKeySecret}`,
      "Content-Type": "application/json",
    }),
    [apiKeySecret],
  );

  const refresh = useCallback(async () => {
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
    } catch (e) {
      setError((e as Error).message);
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

  return (
    <Card className="flex h-[70vh] flex-col">
      <CardHeader className="flex-row items-center justify-between border-b py-3">
        <CardTitle className="text-base font-medium">
          <span className="text-muted-foreground">#</span>
          {topicName}
        </CardTitle>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="font-mono">
            {meshSlug}
          </Badge>
          <span className="text-muted-foreground">
            key expires {fmtTime(apiKeyExpiresAt)}
          </span>
        </div>
      </CardHeader>

      <CardContent
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No messages yet. Be the first.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-0.5">
                <div className="text-muted-foreground flex items-baseline gap-2 text-xs">
                  <span className="font-medium text-foreground">
                    {m.senderName || m.senderPubkey.slice(0, 8)}
                  </span>
                  <span className="font-mono">
                    {m.senderPubkey.slice(0, 6)}…
                  </span>
                  <span>{fmtTime(m.createdAt)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {decodeIncoming(m.ciphertext)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>

      <div className="border-t p-3">
        {error ? (
          <p className="mb-2 text-xs text-destructive">{error}</p>
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
            placeholder={`Message #${topicName}…`}
            rows={1}
            className="flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button type="submit" disabled={sending || !draft.trim()}>
            {sending ? "…" : "Send"}
          </Button>
        </form>
      </div>
    </Card>
  );
}
