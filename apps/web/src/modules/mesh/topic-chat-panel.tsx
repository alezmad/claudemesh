"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@turbostarter/ui-web/button";

import {
  decryptMessage,
  encryptMessage,
  getTopicKey,
  registerBrowserPeerPubkey,
} from "~/services/crypto/topic-key";

interface TopicMessage {
  id: string;
  senderPubkey: string;
  senderName: string;
  nonce: string;
  ciphertext: string;
  /** 1 = legacy plaintext-base64. 2 = crypto_secretbox under topic key. */
  bodyVersion?: number;
  replyToId?: string | null;
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
 * v1 (legacy plaintext-base64) decode path. v0.2.0 messages used this
 * fake-encryption stub; real v0.3.0 ciphertext is decrypted via the
 * topic key — see `decryptForRender` below.
 */
function decodeV1(ciphertext: string): string {
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

/** Encode v1 plaintext for the rare fallback path when a topic has no
 *  encryption key (legacy v0.2.0 topics). v0.3.0+ topics encrypt via
 *  `encryptMessage` from the topic-key service. */
function encodeV1Outgoing(plaintext: string): { ciphertext: string; nonce: string } {
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

/**
 * Render plaintext with @mentions highlighted in clay. We split on the
 * mention regex and rebuild as alternating spans so React can reconcile
 * keys cleanly. URL/markdown parsing is out of scope for v0.2.0.
 */
function renderWithMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(^|\s)(@[A-Za-z0-9_-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    const [, lead, mention] = match;
    const matchStart = match.index + (lead?.length ?? 0);
    if (matchStart > lastIndex) {
      parts.push(
        <span key={key++}>{text.slice(lastIndex, matchStart)}</span>,
      );
    }
    parts.push(
      <span key={key++} className="text-[var(--cm-clay)] font-medium">
        {mention}
      </span>,
    );
    lastIndex = matchStart + (mention?.length ?? 0);
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return parts;
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
  const [mentionState, setMentionState] = useState<{
    query: string;
    start: number;
    selected: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastMarkReadAtRef = useRef<number>(0);

  // v0.3.0 per-topic encryption state.
  // `topicKey` is the 32-byte symmetric key for the active topic (null =
  // unencrypted / not yet sealed for this browser). `keyState` distinguishes
  // the three reasons we might not have a key yet, so the UI can show the
  // right message ("waiting for a CLI peer to share the key" vs "topic is
  // legacy plaintext" vs "decrypt failed").
  const [topicKey, setTopicKey] = useState<Uint8Array | null>(null);
  const [keyState, setKeyState] = useState<
    "loading" | "ready" | "not_sealed" | "topic_unencrypted" | "error"
  >("loading");
  // Decrypted plaintext per message id, computed lazily on render.
  const [decrypted, setDecrypted] = useState<Map<string, string>>(new Map());

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

  // Per-topic encryption bootstrap.
  //
  // On mount: register the browser's IndexedDB-persisted pubkey against
  // mesh.member.peer_pubkey (idempotent), then ask /v1/topics/:name/key
  // for our sealed copy. If no peer has sealed for us yet (404), poll
  // every 5s — the CLI's 30s re-seal loop will eventually catch up.
  // If the topic is unencrypted (legacy v0.2.0), fall through to v1.
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const tryFetchKey = async (firstAttempt: boolean) => {
      try {
        if (firstAttempt) {
          // Idempotent — only writes on first run / after rotation.
          await registerBrowserPeerPubkey(apiKeySecret);
        }
        const res = await getTopicKey({ apiKeySecret, topicName });
        if (cancelled) return;
        if (res.ok && res.topicKey) {
          setTopicKey(res.topicKey);
          setKeyState("ready");
          return;
        }
        if (res.error === "topic_unencrypted") {
          setTopicKey(null);
          setKeyState("topic_unencrypted");
          return;
        }
        if (res.error === "not_sealed") {
          setTopicKey(null);
          setKeyState("not_sealed");
          // Re-poll: a CLI peer's re-seal loop runs every 30s, so 5s
          // here gives a quick reaction without hammering the server.
          pollTimer = setTimeout(() => void tryFetchKey(false), 5000);
          return;
        }
        setKeyState("error");
      } catch {
        if (!cancelled) setKeyState("error");
      }
    };
    void tryFetchKey(true);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [apiKeySecret, topicName]);

  // Decrypt any v2 messages that we haven't decrypted yet. Runs after
  // `messages` updates (history backfill, SSE delivery) and after
  // `topicKey` lands.
  useEffect(() => {
    if (!topicKey) return;
    let cancelled = false;
    (async () => {
      const additions = new Map<string, string>();
      for (const m of messages) {
        if ((m.bodyVersion ?? 1) !== 2) continue;
        if (decrypted.has(m.id)) continue;
        const plain = await decryptMessage(topicKey, m.ciphertext, m.nonce);
        additions.set(m.id, plain ?? "[decrypt failed]");
      }
      if (cancelled || additions.size === 0) return;
      setDecrypted((prev) => {
        const next = new Map(prev);
        for (const [k, v] of additions) next.set(k, v);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, topicKey, decrypted]);

  // Render-time text resolution: v2 -> decrypted cache; v1 -> legacy decode.
  // Falls back to a placeholder if v2 hasn't been decrypted yet (the
  // useEffect above will fill it in).
  const resolveText = useCallback(
    (m: TopicMessage): string => {
      if ((m.bodyVersion ?? 1) === 2) {
        return decrypted.get(m.id) ?? "🔒 decrypting…";
      }
      return decodeV1(m.ciphertext);
    },
    [decrypted],
  );

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
          // 4xx is terminal — auth invalid, key revoked, topic gone.
          // Reconnecting won't fix any of those, so surface the error
          // and stop. 5xx and network errors fall through to backoff.
          if (res.status >= 400 && res.status < 500) {
            const body = await res.text().catch(() => "");
            setError(`stream halted: ${res.status} ${body.slice(0, 200)}`);
            setStreamState("stopped");
            return;
          }
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
    // Don't yank scroll while the user is searching — they're reading
    // matches, not the live tail.
    if (searchQuery.trim()) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, searchQuery]);

  // Member name lookup for autocomplete. Filtered by case-insensitive
  // prefix match on displayName; shorter names rank higher so e.g. "@al"
  // surfaces "Alice" above "Alejandro" if both exist. Capped at 8.
  const mentionMatches = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    return members
      .filter((m) => m.displayName.toLowerCase().startsWith(q))
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.displayName.length - b.displayName.length;
      })
      .slice(0, 8);
  }, [members, mentionState]);

  // Re-evaluate the @-mention context whenever the textarea changes —
  // we look at the substring before the cursor and check whether it
  // ends in `@<word>` with no whitespace between the @ and the cursor.
  const updateMentionFromCursor = useCallback(
    (value: string, cursor: number) => {
      const before = value.slice(0, cursor);
      const m = before.match(/(^|\s)@([A-Za-z0-9_-]*)$/);
      if (!m) {
        setMentionState(null);
        return;
      }
      const query = m[2] ?? "";
      const start = before.length - query.length - 1; // index of '@'
      setMentionState((prev) =>
        prev && prev.start === start && prev.query === query
          ? prev
          : { query, start, selected: 0 },
      );
    },
    [],
  );

  const insertMention = useCallback(
    (memberName: string) => {
      if (!mentionState) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const before = draft.slice(0, mentionState.start);
      const after = draft.slice(ta.selectionStart);
      const replacement = `@${memberName} `;
      const next = before + replacement + after;
      const nextCursor = before.length + replacement.length;
      setDraft(next);
      setMentionState(null);
      // Restore cursor + focus on the next tick — React schedules the
      // value update, so we can't mutate selection in the same frame.
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [draft, mentionState],
  );

  // Extract @-mention tokens from the draft body so the server can
  // populate mesh.notification rows without having to read the
  // ciphertext (forward-compat with v0.3.0 per-topic encryption).
  // Capped at 16 to bound notification fan-out.
  const extractMentions = (text: string): string[] => {
    const found = new Set<string>();
    const re = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]{1,64})(?=$|[^A-Za-z0-9_-])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.add(m[2]!.toLowerCase());
      if (found.size >= 16) break;
    }
    return [...found];
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      let ciphertext: string;
      let nonce: string;
      let bodyVersion: 1 | 2;
      if (topicKey && keyState === "ready") {
        const enc = await encryptMessage(topicKey, text);
        ciphertext = enc.ciphertext;
        nonce = enc.nonce;
        bodyVersion = 2;
      } else {
        // Legacy unencrypted topic, or sealed-key not yet available.
        // Sending v1 plaintext keeps the chat working in either case;
        // CLI peers on encrypted topics will read it as v1 (alongside
        // their v2 traffic) without the round-trip breaking.
        const enc = encodeV1Outgoing(text);
        ciphertext = enc.ciphertext;
        nonce = enc.nonce;
        bodyVersion = 1;
      }
      const mentions = extractMentions(text);
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          topic: topicName,
          ciphertext,
          nonce,
          bodyVersion,
          ...(mentions.length > 0 ? { mentions } : {}),
        }),
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

  // Client-side search over loaded messages. Decodes once per query so
  // we can filter on plaintext, then highlights matches in render.
  // Server-side fulltext lands when we move ciphertext to per-topic
  // keys (v0.3.0) — until then there's no server index to query.
  const searchTerm = searchQuery.trim().toLowerCase();
  const filteredMessages = useMemo(() => {
    if (!searchTerm) return messages;
    return messages.filter((m) =>
      resolveText(m).toLowerCase().includes(searchTerm) ||
      (m.senderName ?? "").toLowerCase().includes(searchTerm),
    );
  }, [messages, searchTerm, resolveText]);

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
        <div className="flex items-center gap-3">
          {searchOpen ? (
            <input
              autoFocus
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }}
              placeholder="search…"
              className="w-44 rounded-[var(--cm-radius-sm)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-2 py-1 text-[11px] text-[var(--cm-fg)] placeholder:text-[var(--cm-fg-tertiary)] focus:border-[var(--cm-border-hover)] focus:outline-none"
            />
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSearchOpen((o) => {
                const next = !o;
                if (!next) setSearchQuery("");
                return next;
              });
            }}
            className="text-[10px] uppercase tracking-[0.14em] text-[var(--cm-fg-tertiary)] transition-colors hover:text-[var(--cm-fg-secondary)]"
            title="Toggle search (Esc to close)"
          >
            {searchOpen ? "close" : "search"}
          </button>
          <span className="text-[10px] text-[var(--cm-fg-tertiary)]">
            {searchTerm
              ? `${filteredMessages.length}/${messages.length}`
              : `${messages.length} msg`}
            {" · "}
            {stateLabel}
          </span>
        </div>
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
        ) : filteredMessages.length === 0 ? (
          <p
            className="py-12 text-center text-[11px] text-[var(--cm-fg-tertiary)]"
            style={monoStyle}
          >
            no matches for &ldquo;{searchTerm}&rdquo;
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {filteredMessages.map((m) => (
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
                  {(m.bodyVersion ?? 1) === 2 ? (
                    <span
                      className="mr-1 text-[var(--cm-fg-tertiary)]"
                      title="end-to-end encrypted (v0.3.0 per-topic)"
                    >
                      🔒
                    </span>
                  ) : null}
                  {renderWithMentions(resolveText(m))}
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
        {keyState === "not_sealed" ? (
          <p
            className="mb-2 text-[10px] text-[var(--cm-fg-tertiary)]"
            style={monoStyle}
            title="The CLI's 30s re-seal loop will share the topic key with this browser shortly. Messages you send now go as v1 plaintext."
          >
            🔒 waiting for a CLI peer to share the topic key — sending v1 plaintext until then
          </p>
        ) : keyState === "ready" ? (
          <p
            className="mb-2 text-[10px] text-[var(--cm-fg-tertiary)]"
            style={monoStyle}
            title="Messages you send are encrypted with the topic's symmetric key (crypto_secretbox)."
          >
            🔒 end-to-end encrypted (v0.3.0)
          </p>
        ) : null}
        <form
          className="relative flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {/* @-mention dropdown anchored above the textarea */}
          {mentionState && mentionMatches.length > 0 ? (
            <ul
              className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-56 overflow-y-auto rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] shadow-lg"
              style={monoStyle}
            >
              {mentionMatches.map((m, i) => {
                const selected = i === mentionState.selected;
                return (
                  <li key={m.memberId}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        // mouseDown (not click) prevents the textarea
                        // from losing focus before the insert runs.
                        e.preventDefault();
                        insertMention(m.displayName);
                      }}
                      onMouseEnter={() =>
                        setMentionState((prev) =>
                          prev ? { ...prev, selected: i } : prev,
                        )
                      }
                      className={
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] " +
                        (selected
                          ? "bg-[var(--cm-bg-hover)]"
                          : "hover:bg-[var(--cm-bg-hover)]")
                      }
                    >
                      <span
                        className={
                          "inline-block h-1.5 w-1.5 shrink-0 rounded-full " +
                          (m.online
                            ? m.status === "dnd"
                              ? "bg-[#c46686]"
                              : m.status === "working"
                                ? "bg-[var(--cm-clay)]"
                                : "bg-emerald-500"
                            : "bg-[var(--cm-fg-tertiary)]")
                        }
                      />
                      <span className="text-[var(--cm-fg)]">
                        {m.displayName}
                      </span>
                      {!m.isHuman ? (
                        <span className="text-[8px] uppercase tracking-[0.1em] text-[var(--cm-fg-tertiary)]">
                          bot
                        </span>
                      ) : null}
                      <span className="ml-auto text-[10px] text-[var(--cm-fg-tertiary)]">
                        {m.online ? "online" : "offline"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              updateMentionFromCursor(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              );
            }}
            onKeyUp={(e) => {
              const t = e.currentTarget;
              updateMentionFromCursor(t.value, t.selectionStart ?? t.value.length);
            }}
            onClick={(e) => {
              const t = e.currentTarget;
              updateMentionFromCursor(t.value, t.selectionStart ?? t.value.length);
            }}
            onBlur={() => {
              // Defer so onMouseDown on the dropdown can resolve first.
              setTimeout(() => setMentionState(null), 100);
            }}
            placeholder={`message #${topicName}…`}
            rows={1}
            className="flex-1 resize-none rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-3 py-2 text-sm text-[var(--cm-fg)] placeholder:text-[var(--cm-fg-tertiary)] focus:border-[var(--cm-border-hover)] focus:outline-none"
            onKeyDown={(e) => {
              // Mention navigation takes priority when the dropdown is up.
              if (mentionState && mentionMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionState((prev) =>
                    prev
                      ? {
                          ...prev,
                          selected: (prev.selected + 1) % mentionMatches.length,
                        }
                      : prev,
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionState((prev) =>
                    prev
                      ? {
                          ...prev,
                          selected:
                            (prev.selected - 1 + mentionMatches.length) %
                            mentionMatches.length,
                        }
                      : prev,
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const target = mentionMatches[mentionState.selected];
                  if (target) insertMention(target.displayName);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionState(null);
                  return;
                }
              }
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
