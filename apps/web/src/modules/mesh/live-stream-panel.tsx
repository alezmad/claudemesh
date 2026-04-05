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
  MeshStream,
  type StreamMessage,
  type StreamPeer,
} from "~/modules/marketing/home/mesh-stream";

const POLL_INTERVAL_MS = 4000;

const classifyTarget = (
  target: string,
): "direct" | "ask_mesh" | "broadcast" => {
  if (target === "*") return "broadcast";
  if (target.startsWith("tag:")) return "ask_mesh";
  return "direct";
};

const buildStream = (data: GetMyMeshStreamResponse) => {
  const peers: StreamPeer[] = data.presences.map((p) => ({
    id: p.memberId,
    name: p.displayName ?? p.memberId.slice(0, 8),
    status: p.status === "dnd" ? "dnd" : p.status,
    machine: p.cwd,
    surface: "terminal",
  }));

  const messages: StreamMessage[] = data.envelopes
    .slice()
    .reverse()
    .map((e) => ({
      key: e.id,
      from: e.senderMemberId,
      to: e.targetSpec,
      type: classifyTarget(e.targetSpec),
      ciphertext: e.ciphertextPreview,
      createdAt: new Date(e.createdAt),
    }));

  return { peers, messages };
};

export const LiveStreamPanel = ({ meshId }: { meshId: string }) => {
  const { data, isLoading, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["mesh", "stream", meshId],
    queryFn: () =>
      handle(api.my.meshes[":id"].stream.$get, {
        schema: getMyMeshStreamResponseSchema,
      })({ param: { id: meshId } }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const { peers, messages } = useMemo(
    () =>
      data ? buildStream(data) : { peers: [], messages: [] },
    [data],
  );

  const secondsAgo = dataUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000))
    : null;

  const footer = (
    <div
      className="flex items-center justify-between px-4 py-2 text-[10px] text-[var(--cm-fg-tertiary)]"
      style={{ fontFamily: "var(--cm-font-mono)" }}
    >
      <span>
        {messages.length} envelopes · {peers.length} live peers
      </span>
      <span>
        {isFetching ? "▶ polling…" : `↻ ${secondsAgo ?? "—"}s ago`}
        {" · "}every {POLL_INTERVAL_MS / 1000}s
      </span>
      <span>read-only · E2E encrypted</span>
    </div>
  );

  const emptyLabel = isLoading
    ? "Connecting to mesh…"
    : "No envelopes yet. When your peers send messages they'll appear here.";

  return (
    <div className="overflow-hidden rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg)]">
      <div
        className="flex items-center justify-between border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/60 px-4 py-3"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (isFetching ? "bg-[var(--cm-clay)] animate-pulse" : "bg-emerald-500")
            }
          />
          <span className="text-[11px] text-[var(--cm-fg-secondary)]">
            live · polling every {POLL_INTERVAL_MS / 1000}s
          </span>
        </div>
      </div>
      <MeshStream
        peers={peers}
        messages={messages}
        channelLabel="live-stream"
        emptyLabel={emptyLabel}
        footer={footer}
        scrollable
      />
    </div>
  );
};
