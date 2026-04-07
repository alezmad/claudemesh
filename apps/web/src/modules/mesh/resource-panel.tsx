"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

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

interface ResourceCard {
  key: string;
  icon: string;
  label: string;
  count: number;
  items: { id: string; text: string; sub: string }[];
  accent: string;
}

/* ------------------------------------------------------------------ */
/*  Build resource cards from stream data                              */
/* ------------------------------------------------------------------ */

const buildResources = (data: GetMyMeshStreamResponse): ResourceCard[] => {
  const onlinePeers = data.presences.filter((p) => !p.disconnectedAt);
  const offlinePeers = data.presences.filter((p) => p.disconnectedAt);

  const priorityCounts = { now: 0, next: 0, low: 0 };
  for (const e of data.envelopes) {
    priorityCounts[e.priority] = (priorityCounts[e.priority] ?? 0) + 1;
  }

  // Unique senders
  const uniqueSenders = new Set(data.envelopes.map((e) => e.senderMemberId));

  // Recent audit event types
  const eventTypes = new Map<string, number>();
  for (const e of data.auditEvents) {
    eventTypes.set(e.eventType, (eventTypes.get(e.eventType) ?? 0) + 1);
  }

  return [
    {
      key: "peers",
      icon: "⬡",
      label: "Live Peers",
      count: onlinePeers.length,
      accent: "text-emerald-500",
      items: onlinePeers.slice(0, 4).map((p) => ({
        id: p.id,
        text: p.displayName ?? p.memberId.slice(0, 8),
        sub: `${p.status} · ${p.cwd.split("/").pop() ?? p.cwd}`,
      })),
    },
    {
      key: "envelopes",
      icon: "▤",
      label: "Envelopes",
      count: data.envelopes.length,
      accent: "text-[var(--cm-clay)]",
      items: [
        {
          id: "priority-now",
          text: `${priorityCounts.now} now`,
          sub: "urgent / bypass busy",
        },
        {
          id: "priority-next",
          text: `${priorityCounts.next} next`,
          sub: "default priority",
        },
        {
          id: "priority-low",
          text: `${priorityCounts.low} low`,
          sub: "pull-only",
        },
        {
          id: "senders",
          text: `${uniqueSenders.size} unique senders`,
          sub: "across all envelopes",
        },
      ],
    },
    {
      key: "events",
      icon: "◈",
      label: "Audit Events",
      count: data.auditEvents.length,
      accent: "text-[#c46686]",
      items: Array.from(eventTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([type, count]) => ({
          id: `evt-${type}`,
          text: type.replace(/_/g, " "),
          sub: `${count} occurrence${count !== 1 ? "s" : ""}`,
        })),
    },
    {
      key: "sessions",
      icon: "⊡",
      label: "Sessions",
      count: data.presences.length,
      accent: "text-[var(--cm-fg-secondary)]",
      items: [
        {
          id: "online",
          text: `${onlinePeers.length} online`,
          sub: "currently connected",
        },
        {
          id: "offline",
          text: `${offlinePeers.length} offline`,
          sub: "recently disconnected",
        },
        ...data.presences
          .filter((p) => p.status === "working")
          .slice(0, 2)
          .map((p) => ({
            id: `working-${p.id}`,
            text: `${p.displayName ?? p.memberId.slice(0, 8)}`,
            sub: "currently working",
          })),
      ],
    },
  ];
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const ResourcePanel = ({ meshId }: { meshId: string }) => {
  const { data, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["mesh", "stream", meshId],
    queryFn: () =>
      handle(api.my.meshes[":id"].stream.$get, {
        schema: getMyMeshStreamResponseSchema,
      })({ param: { id: meshId } }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const resources = useMemo(
    () => (data ? buildResources(data) : []),
    [data],
  );

  const secondsAgo = dataUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000))
    : null;

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
            resources
          </span>
        </div>
        <span className="text-[10px] text-[var(--cm-fg-tertiary)]">
          {isFetching ? "polling\u2026" : `${secondsAgo ?? "\u2014"}s ago`}
        </span>
      </div>

      {/* Resource cards grid */}
      <div
        className="grid grid-cols-2 gap-px bg-[var(--cm-border)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        {resources.map((card) => (
          <div
            key={card.key}
            className="flex flex-col bg-[var(--cm-bg)] p-3"
          >
            {/* Card header */}
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className={`text-[11px] ${card.accent}`}>
                  {card.icon}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]">
                  {card.label}
                </span>
              </div>
              <span className={`text-lg font-semibold leading-none tabular-nums ${card.accent}`}>
                {card.count}
              </span>
            </div>

            {/* Recent items */}
            <div className="flex flex-col gap-1">
              {card.items.length === 0 ? (
                <span className="text-[9px] text-[var(--cm-fg-tertiary)]">
                  none
                </span>
              ) : (
                card.items.map((item) => (
                  <div key={item.id} className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[10px] text-[var(--cm-fg-secondary)] truncate">
                        {item.text}
                      </span>
                    </div>
                    <div className="text-[9px] text-[var(--cm-fg-tertiary)] truncate">
                      {item.sub}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between border-t border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30 px-4 py-2 text-[9px] text-[var(--cm-fg-tertiary)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        <span>derived from stream data</span>
        <span>read-only snapshot</span>
      </div>
    </div>
  );
};
