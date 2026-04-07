"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import {
  getMyMeshStreamResponseSchema,
  type GetMyMeshStreamResponse,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/client";

const POLL_INTERVAL_MS = 4000;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TimelineEntry {
  id: string;
  timestamp: Date;
  type: "audit" | "presence" | "envelope";
  icon: string;
  label: string;
  detail: string;
  actor: string | null;
}

/* ------------------------------------------------------------------ */
/*  Build timeline from stream data                                    */
/* ------------------------------------------------------------------ */

const EVENT_LABELS: Record<string, string> = {
  peer_connected: "connected",
  peer_disconnected: "disconnected",
  message_sent: "msg sent",
  message_delivered: "msg delivered",
  invite_created: "invite created",
  invite_redeemed: "invite redeemed",
  member_joined: "member joined",
  member_removed: "member removed",
  state_changed: "state changed",
};

const EVENT_ICONS: Record<string, string> = {
  peer_connected: "↑",
  peer_disconnected: "↓",
  message_sent: "→",
  message_delivered: "✓",
  invite_created: "✉",
  invite_redeemed: "★",
  member_joined: "+",
  member_removed: "−",
  state_changed: "Δ",
};

const buildTimeline = (data: GetMyMeshStreamResponse): TimelineEntry[] => {
  const entries: TimelineEntry[] = [];

  // Audit events → timeline entries
  for (const e of data.auditEvents) {
    entries.push({
      id: e.id,
      timestamp: new Date(e.createdAt),
      type: "audit",
      icon: EVENT_ICONS[e.eventType] ?? "•",
      label: EVENT_LABELS[e.eventType] ?? e.eventType.replace(/_/g, " "),
      detail: [
        e.actorPeerId ? `actor:${e.actorPeerId.slice(0, 8)}` : null,
        e.targetPeerId ? `target:${e.targetPeerId.slice(0, 8)}` : null,
      ]
        .filter(Boolean)
        .join(" → ") || "—",
      actor: e.actorPeerId,
    });
  }

  // Presence status snapshots → timeline entries (latest status per peer)
  for (const p of data.presences) {
    entries.push({
      id: `presence-${p.id}`,
      timestamp: new Date(p.statusUpdatedAt),
      type: "presence",
      icon: p.status === "idle" ? "◇" : p.status === "working" ? "◆" : "◈",
      label: `${p.displayName ?? p.memberId.slice(0, 8)} → ${p.status}`,
      detail: `via ${p.statusSource} · pid ${p.pid}`,
      actor: p.memberId,
    });
  }

  // Sort descending (newest first)
  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return entries;
};

/* ------------------------------------------------------------------ */
/*  Format helpers                                                     */
/* ------------------------------------------------------------------ */

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const TYPE_COLORS: Record<TimelineEntry["type"], string> = {
  audit: "text-[var(--cm-clay)]",
  presence: "text-emerald-500",
  envelope: "text-[#c46686]",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const StateTimelinePanel = ({ meshId }: { meshId: string }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["mesh", "stream", meshId],
    queryFn: () =>
      handle(api.my.meshes[":id"].stream.$get, {
        schema: getMyMeshStreamResponseSchema,
      })({ param: { id: meshId } }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const entries = useMemo(
    () => (data ? buildTimeline(data) : []),
    [data],
  );

  const secondsAgo = dataUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000))
    : null;

  // Auto-scroll to top (newest) on new data
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg)]">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/60 px-4 py-3"
        style={{ fontFamily: "var(--cm-font-mono)" }}
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
            event timeline
          </span>
        </div>
        <span className="text-[10px] text-[var(--cm-fg-tertiary)]">
          {entries.length} events ·{" "}
          {isFetching ? "polling\u2026" : `${secondsAgo ?? "\u2014"}s ago`}
        </span>
      </div>

      {/* Timeline body */}
      <div
        ref={scrollRef}
        className="max-h-[420px] overflow-y-auto scrollbar-thin"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        {entries.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[11px] text-[var(--cm-fg-tertiary)]">
            No events recorded yet.
          </div>
        ) : (
          <div className="relative px-4 py-3">
            {/* Vertical spine */}
            <div className="absolute left-[27px] top-3 bottom-3 w-px bg-[var(--cm-border)]" />

            {entries.map((entry, i) => (
              <div
                key={entry.id}
                className="group relative flex items-start gap-3 py-1.5"
              >
                {/* Node dot */}
                <div className="relative z-10 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  <span
                    className={`text-[10px] leading-none ${TYPE_COLORS[entry.type]}`}
                  >
                    {entry.icon}
                  </span>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] text-[var(--cm-fg-tertiary)] tabular-nums">
                      {fmtTime(entry.timestamp)}
                    </span>
                    <span className={`text-[11px] font-medium ${TYPE_COLORS[entry.type]}`}>
                      {entry.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--cm-fg-tertiary)] truncate">
                    {entry.detail}
                  </div>
                </div>

                {/* Type badge */}
                <span className="flex-shrink-0 rounded border border-[var(--cm-border)] px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]">
                  {entry.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer legend */}
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30 px-4 py-2 text-[9px] text-[var(--cm-fg-tertiary)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-[var(--cm-clay)]">•</span>
          audit
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-emerald-500">•</span>
          presence
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[#c46686]">•</span>
          envelope
        </span>
        <span className="mx-1 text-[var(--cm-border)]">|</span>
        <span>newest first · auto-scroll</span>
      </div>
    </div>
  );
};
