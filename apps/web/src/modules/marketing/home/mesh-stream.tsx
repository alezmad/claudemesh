"use client";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";

export type PeerStatus = "idle" | "working" | "dnd" | "offline";
export type MessageType = "ask_mesh" | "self_nominate" | "direct" | "broadcast";

export interface StreamPeer {
  id: string;
  name: string;
  status: PeerStatus;
  /** e.g. "macOS · payments-api" or "iOS · push-relay" */
  machine: string;
  surface?: "terminal" | "phone" | "slack";
}

export interface StreamMessage {
  /** stable unique key */
  key: string;
  /** peer id or display name */
  from: string;
  /** peer id, "tag:xxx", "*", or null (self-nominate) */
  to: string | null;
  type: MessageType;
  /** plaintext for demo, undefined for live (broker never sees it) */
  text?: string;
  /** truncated base64url — what the broker actually sees */
  ciphertext: string;
  /** absolute time, optional — used by live dashboard */
  createdAt?: Date;
}

const STATUS_DOT: Record<PeerStatus, string> = {
  idle: "bg-emerald-500",
  working: "bg-[var(--cm-clay)] animate-pulse",
  dnd: "bg-[#c46686]",
  offline: "bg-[var(--cm-fg-tertiary)]",
};

const TYPE_CHIP: Record<MessageType, { label: string; className: string }> = {
  ask_mesh: {
    label: "broadcast",
    className:
      "border-[var(--cm-border)] bg-[var(--cm-bg)] text-[var(--cm-clay)]",
  },
  broadcast: {
    label: "broadcast",
    className:
      "border-[var(--cm-border)] bg-[var(--cm-bg)] text-[var(--cm-clay)]",
  },
  self_nominate: {
    label: "hand-raise",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  },
  direct: {
    label: "direct",
    className:
      "border-[var(--cm-border)] bg-[var(--cm-bg)] text-[var(--cm-fg-secondary)]",
  },
};

const TYPE_ICON: Record<MessageType, React.ReactNode> = {
  ask_mesh: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 3v18M3 12h18" />
    </svg>
  ),
  broadcast: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 3v18M3 12h18" />
    </svg>
  ),
  self_nominate: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  direct: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ),
};

const surfaceGlyph = (s?: StreamPeer["surface"]) => {
  if (s === "phone")
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <rect x="7" y="2" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="18" r="1" fill="currentColor" />
      </svg>
    );
  if (s === "slack")
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <rect x="10" y="3" width="2" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
        <rect x="12" y="15" width="2" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
        <rect x="3" y="10" width="6" height="2" rx="1" stroke="currentColor" strokeWidth="2" />
        <rect x="15" y="12" width="6" height="2" rx="1" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M6 9l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

const resolveName = (id: string, peers: StreamPeer[]) =>
  peers.find((p) => p.id === id)?.name ?? id;

export interface MeshStreamProps {
  peers: StreamPeer[];
  messages: StreamMessage[];
  /** text shown in stream header, right of # */
  channelLabel?: string;
  /** override the "N peers online" hint */
  peersHint?: string;
  /** override empty-state message */
  emptyLabel?: string;
  /** footer content (stats / progress bar / timers) */
  footer?: React.ReactNode;
  /**
   * When true (live dashboard), the message list gets a fixed viewport
   * with overflow-y-auto — standard chat UI. When false (landing demo),
   * the list grows intrinsically so wheel events pass through to the
   * page scroll instead of being captured by the list.
   */
  scrollable?: boolean;
}

export const MeshStream = ({
  peers,
  messages,
  channelLabel = "live-stream",
  peersHint,
  emptyLabel = "Waiting for messages…",
  footer,
  scrollable = false,
}: MeshStreamProps) => {
  const [focusedPeer, setFocusedPeer] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const onlineCount = peers.filter((p) => p.status !== "offline").length;
  const filtered = focusedPeer
    ? messages.filter((m) => m.from === focusedPeer || m.to === focusedPeer)
    : messages;

  return (
    <div
      className={
        "grid grid-cols-1 md:grid-cols-[220px_1fr] " +
        (scrollable ? "min-h-[480px]" : "")
      }
    >
      {/* peers sidebar */}
      <aside
        className="border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/20 p-4 md:border-b-0 md:border-r"
        style={{ fontFamily: "var(--cm-font-sans)" }}
      >
        <div
          className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <span>{peersHint ?? `peers · ${onlineCount} online`}</span>
          {focusedPeer && (
            <button
              onClick={() => setFocusedPeer(null)}
              className="text-[var(--cm-clay)] hover:underline"
              aria-label="Clear filter"
            >
              clear
            </button>
          )}
        </div>
        {peers.length === 0 ? (
          <p
            className="text-[12px] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            no peers online
          </p>
        ) : (
          <ul className="space-y-1">
            {peers.map((p) => {
              const active = focusedPeer === p.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setFocusedPeer(active ? null : p.id)}
                    className={
                      "group flex w-full items-center gap-2.5 rounded-[var(--cm-radius-xs)] px-2 py-1.5 text-left transition-colors " +
                      (active
                        ? "bg-[var(--cm-clay)]/15"
                        : "hover:bg-[var(--cm-bg)]")
                    }
                  >
                    <span
                      className={
                        "h-2 w-2 flex-shrink-0 rounded-full " +
                        STATUS_DOT[p.status]
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={
                            "truncate text-[13px] " +
                            (active
                              ? "font-medium text-[var(--cm-clay)]"
                              : "text-[var(--cm-fg)]")
                          }
                        >
                          {p.name}
                        </span>
                        <span className="text-[var(--cm-fg-tertiary)]">
                          {surfaceGlyph(p.surface)}
                        </span>
                      </div>
                      <div
                        className="truncate text-[10px] text-[var(--cm-fg-tertiary)]"
                        style={{ fontFamily: "var(--cm-font-mono)" }}
                      >
                        {p.machine}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* message stream */}
      <div
        className="relative flex flex-col"
        style={{ fontFamily: "var(--cm-font-sans)" }}
      >
        <div
          className="flex items-center gap-2 border-b border-[var(--cm-border)] px-4 py-2.5"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <span className="text-[var(--cm-clay)]">#</span>
          <span className="text-[13px] font-medium text-[var(--cm-fg)]">
            {channelLabel}
          </span>
          <span className="text-[11px] text-[var(--cm-fg-tertiary)]">
            {focusedPeer
              ? `filtered: ${resolveName(focusedPeer, peers)}`
              : "all peers · E2E encrypted"}
          </span>
        </div>
        <ol
          className={
            "space-y-3 p-4 " +
            (scrollable ? "flex-1 overflow-y-auto" : "")
          }
        >
          {filtered.length === 0 && (
            <li
              className="py-8 text-center text-[13px] text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              {emptyLabel}
            </li>
          )}
          <AnimatePresence initial={false}>
            {filtered.map((m) => (
              <motion.li
                key={m.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 0.4,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
                onMouseEnter={() => setHoveredKey(m.key)}
                onMouseLeave={() => setHoveredKey(null)}
                className="group relative"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 pt-0.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cm-bg-elevated)] text-[10px] font-medium uppercase text-[var(--cm-fg-secondary)]">
                      {resolveName(m.from, peers).slice(0, 2)}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--cm-fg)]">
                        {resolveName(m.from, peers)}
                      </span>
                      {m.to && (
                        <>
                          <span className="text-[11px] text-[var(--cm-fg-tertiary)]">
                            →
                          </span>
                          <span
                            className="text-[12px] text-[var(--cm-fg-secondary)]"
                            style={{ fontFamily: "var(--cm-font-mono)" }}
                          >
                            {m.to.startsWith("tag:") || m.to === "*"
                              ? m.to
                              : resolveName(m.to, peers)}
                          </span>
                        </>
                      )}
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider " +
                          TYPE_CHIP[m.type].className
                        }
                      >
                        {TYPE_ICON[m.type]}
                        {TYPE_CHIP[m.type].label}
                      </span>
                      {m.createdAt && (
                        <span
                          className="text-[10px] text-[var(--cm-fg-tertiary)]"
                          style={{ fontFamily: "var(--cm-font-mono)" }}
                        >
                          {m.createdAt.toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    {m.text && (
                      <p
                        className="text-[14px] leading-[1.55] text-[var(--cm-fg-secondary)]"
                        style={{ fontFamily: "var(--cm-font-serif)" }}
                      >
                        {m.text}
                      </p>
                    )}
                    {hoveredKey === m.key && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-2 rounded-[var(--cm-radius-xs)] border border-dashed border-[var(--cm-clay)]/40 bg-[var(--cm-bg-elevated)]/50 px-3 py-2"
                        style={{ fontFamily: "var(--cm-font-mono)" }}
                      >
                        <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--cm-clay)]">
                          broker sees only this
                        </div>
                        <code className="block break-all text-[11px] text-[var(--cm-fg-tertiary)]">
                          {m.ciphertext}
                          {m.ciphertext && !m.text && "…"}
                        </code>
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        {footer && (
          <div className="border-t border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
