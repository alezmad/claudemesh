"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  getMyMeshStreamResponseSchema,
  type GetMyMeshStreamResponse,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/client";
import {
  PeerGraph,
  type GraphPeer,
  type GraphEdge,
} from "~/modules/mesh/peer-graph";

const POLL_INTERVAL_MS = 4000;

/* ------------------------------------------------------------------ */
/*  Transform broker response into graph-friendly structures           */
/* ------------------------------------------------------------------ */

const buildGraphData = (data: GetMyMeshStreamResponse) => {
  // Count messages per sender
  const countMap = new Map<string, number>();
  for (const e of data.envelopes) {
    countMap.set(e.senderMemberId, (countMap.get(e.senderMemberId) ?? 0) + 1);
  }

  const peers: GraphPeer[] = data.presences.map((p) => ({
    id: p.memberId,
    name: p.displayName ?? p.memberId.slice(0, 8),
    status: p.status === "dnd" ? "dnd" : p.status,
    messageCount: countMap.get(p.memberId) ?? 0,
  }));

  const edges: GraphEdge[] = data.envelopes.map((e) => ({
    key: e.id,
    from: e.senderMemberId,
    to: e.targetSpec === "*" ? null : e.targetSpec,
    priority: e.priority,
    createdAt: new Date(e.createdAt),
  }));

  return { peers, edges };
};

/* ------------------------------------------------------------------ */
/*  Panel component                                                    */
/* ------------------------------------------------------------------ */

export const PeerGraphPanel = ({ meshId }: { meshId: string }) => {
  const { data, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["mesh", "stream", meshId],
    queryFn: () =>
      handle(api.my.meshes[":id"].stream.$get, {
        schema: getMyMeshStreamResponseSchema,
      })({ param: { id: meshId } }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const { peers, edges } = useMemo(
    () => (data ? buildGraphData(data) : { peers: [], edges: [] }),
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
            peer graph
          </span>
        </div>
        <span className="text-[10px] text-[var(--cm-fg-tertiary)]">
          {peers.length} peers ·{" "}
          {isFetching ? "polling\u2026" : `${secondsAgo ?? "\u2014"}s ago`}
        </span>
      </div>

      {/* Graph area */}
      <div className="relative aspect-square w-full min-h-[320px]">
        <PeerGraph peers={peers} edges={edges} />
      </div>

      {/* Legend */}
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30 px-4 py-2 text-[9px] text-[var(--cm-fg-tertiary)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          idle
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--cm-clay)]" />
          working
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#c46686]" />
          dnd
        </span>
        <span className="mx-1 text-[var(--cm-border)]">|</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-3 bg-emerald-500" />
          low
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-3 bg-[var(--cm-fg-secondary)]" />
          next
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-3 bg-red-500" />
          now
        </span>
      </div>
    </div>
  );
};
