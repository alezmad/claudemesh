"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PeerStatus } from "~/modules/marketing/home/mesh-stream";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GraphPeer {
  id: string;
  name: string;
  status: PeerStatus;
  summary?: string;
  /** Number of messages sent by this peer — drives node sizing */
  messageCount: number;
  /** Group names this peer belongs to */
  groups?: string[];
}

export interface GraphEdge {
  key: string;
  from: string;
  to: string | null; // null = broadcast (draw to all)
  priority: "now" | "next" | "low";
  createdAt: Date;
}

export interface PeerGraphProps {
  peers: GraphPeer[];
  edges: GraphEdge[];
  meshName?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_COLOR: Record<PeerStatus, string> = {
  idle: "#22c55e",    // emerald-500
  working: "#d97757", // --cm-clay
  dnd: "#c46686",     // --cm-fig
  offline: "#87867f", // --cm-fg-tertiary
};

const PRIORITY_COLOR: Record<string, string> = {
  low: "#22c55e",
  next: "#c2c0b6",
  now: "#ef4444",
};

/** How long edges remain visible (ms) */
const EDGE_TTL_MS = 8_000;

/** Ring colors for groups — up to 8 distinct groups */
const GROUP_RING_COLORS = [
  "#d97757", // clay
  "#c46686", // fig
  "#bcd1ca", // cactus
  "#e3dacc", // oat
  "#6ea8fe", // blue
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#f472b6", // pink
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Radial layout: peers on a circle, center reserved for mesh label. */
const computeLayout = (
  peerCount: number,
  width: number,
  height: number,
) => {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) * 0.68;
  return { cx, cy, radius };
};

const peerPosition = (
  index: number,
  total: number,
  cx: number,
  cy: number,
  radius: number,
) => {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2; // start at top
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
};

/** Scale node radius based on message volume relative to peers. */
const nodeRadius = (count: number, maxCount: number) => {
  const base = 22;
  const extra = 12;
  if (maxCount === 0) return base;
  return base + (count / maxCount) * extra;
};

/** Build a group-color map from all peers. */
const buildGroupColorMap = (peers: GraphPeer[]) => {
  const seen = new Set<string>();
  for (const p of peers) {
    for (const g of p.groups ?? []) seen.add(g);
  }
  const map = new Map<string, string>();
  let i = 0;
  for (const g of seen) {
    map.set(g, GROUP_RING_COLORS[i % GROUP_RING_COLORS.length]!);
    i++;
  }
  return map;
};

/** Quadratic bezier control point offset for curved edges */
const curveOffset = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
) => {
  // Push the control point toward center for a slight curve
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const factor = 0.15;
  return {
    qx: mx + (cx - mx) * factor,
    qy: my + (cy - my) * factor,
  };
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const PeerGraph = ({ peers, edges, meshName }: PeerGraphProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 520, height: 520 });
  const [now, setNow] = useState(Date.now());

  // Tick every second to fade edges
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Responsive resize
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const { width, height } = dimensions;
  const { cx, cy, radius } = computeLayout(peers.length, width, height);
  const maxCount = useMemo(
    () => Math.max(1, ...peers.map((p) => p.messageCount)),
    [peers],
  );
  const groupColorMap = useMemo(() => buildGroupColorMap(peers), [peers]);

  // Map peer id -> position
  const posMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    peers.forEach((p, i) => {
      m.set(p.id, peerPosition(i, peers.length, cx, cy, radius));
    });
    return m;
  }, [peers, cx, cy, radius]);

  // Filter edges to those still visible
  const visibleEdges = useMemo(
    () => edges.filter((e) => now - e.createdAt.getTime() < EDGE_TTL_MS),
    [edges, now],
  );

  // Build edge paths: direct -> single path, broadcast -> one path per peer
  const edgePaths = useMemo(() => {
    const paths: {
      key: string;
      d: string;
      color: string;
      opacity: number;
    }[] = [];

    for (const e of visibleEdges) {
      const fromPos = posMap.get(e.from);
      if (!fromPos) continue;
      const age = now - e.createdAt.getTime();
      const opacity = Math.max(0, 1 - age / EDGE_TTL_MS);
      const color = PRIORITY_COLOR[e.priority] ?? PRIORITY_COLOR.next!;

      if (e.to === null || e.to === "*") {
        // Broadcast: lines to all other peers
        for (const [pid, pos] of posMap) {
          if (pid === e.from) continue;
          const { qx, qy } = curveOffset(
            fromPos.x,
            fromPos.y,
            pos.x,
            pos.y,
            cx,
            cy,
          );
          paths.push({
            key: `${e.key}-${pid}`,
            d: `M${fromPos.x},${fromPos.y} Q${qx},${qy} ${pos.x},${pos.y}`,
            color,
            opacity: opacity * 0.6,
          });
        }
      } else {
        const toPos = posMap.get(e.to);
        if (!toPos) continue;
        const { qx, qy } = curveOffset(
          fromPos.x,
          fromPos.y,
          toPos.x,
          toPos.y,
          cx,
          cy,
        );
        paths.push({
          key: e.key,
          d: `M${fromPos.x},${fromPos.y} Q${qx},${qy} ${toPos.x},${toPos.y}`,
          color,
          opacity,
        });
      }
    }
    return paths;
  }, [visibleEdges, posMap, cx, cy, now]);

  return (
    <svg
      ref={svgRef}
      className="h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Peer graph for mesh${meshName ? ` "${meshName}"` : ""} showing ${peers.length} peers and recent message traffic`}
      style={{ fontFamily: "var(--cm-font-mono)" }}
    >
      {/* Subtle radial grid */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--cm-border)"
        strokeWidth="1"
        strokeDasharray="4 6"
        opacity="0.4"
      />
      <circle
        cx={cx}
        cy={cy}
        r={radius * 0.5}
        fill="none"
        stroke="var(--cm-border)"
        strokeWidth="0.5"
        strokeDasharray="2 4"
        opacity="0.2"
      />

      {/* Center mesh label */}
      {meshName && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--cm-fg-tertiary)"
          fontSize="11"
          opacity="0.5"
        >
          {meshName}
        </text>
      )}

      {/* Edges */}
      <g>
        {edgePaths.map((ep) => (
          <path
            key={ep.key}
            d={ep.d}
            fill="none"
            stroke={ep.color}
            strokeWidth="1.5"
            opacity={ep.opacity}
            style={{
              transition: "opacity 1s ease-out",
            }}
          />
        ))}
      </g>

      {/* Animated pulse dots traveling along edges */}
      {edgePaths
        .filter((ep) => ep.opacity > 0.3)
        .map((ep) => (
          <circle key={`dot-${ep.key}`} r="2.5" fill={ep.color} opacity={ep.opacity}>
            <animateMotion
              dur="1.2s"
              repeatCount="1"
              path={ep.d}
              fill="freeze"
            />
          </circle>
        ))}

      {/* Peer nodes */}
      {peers.map((peer, i) => {
        const pos = posMap.get(peer.id);
        if (!pos) return null;
        const r = nodeRadius(peer.messageCount, maxCount);
        const groups = peer.groups ?? [];

        return (
          <g key={peer.id}>
            {/* Group rings (concentric, outermost first) */}
            {groups.map((g, gi) => {
              const ringR = r + 5 + gi * 4;
              const ringColor = groupColorMap.get(g) ?? GROUP_RING_COLORS[0]!;
              return (
                <circle
                  key={g}
                  cx={pos.x}
                  cy={pos.y}
                  r={ringR}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="2"
                  strokeDasharray="6 3"
                  opacity="0.55"
                />
              );
            })}

            {/* Outer glow for active status */}
            {peer.status === "working" && (
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r + 2}
                fill="none"
                stroke={STATUS_COLOR.working}
                strokeWidth="1"
                opacity="0.3"
              >
                <animate
                  attributeName="r"
                  values={`${r + 2};${r + 6};${r + 2}`}
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.3;0.08;0.3"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>
            )}

            {/* Node circle */}
            <circle
              cx={pos.x}
              cy={pos.y}
              r={r}
              fill="var(--cm-bg-elevated)"
              stroke={STATUS_COLOR[peer.status]}
              strokeWidth="2"
              style={{ transition: "all 0.6s var(--cm-ease)" }}
            />

            {/* Status indicator dot */}
            <circle
              cx={pos.x + r * 0.6}
              cy={pos.y - r * 0.6}
              r="4"
              fill={STATUS_COLOR[peer.status]}
              stroke="var(--cm-bg)"
              strokeWidth="1.5"
            />

            {/* Initials inside node */}
            <text
              x={pos.x}
              y={pos.y + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--cm-fg)"
              fontSize="11"
              fontWeight="600"
            >
              {peer.name.slice(0, 2).toUpperCase()}
            </text>

            {/* Name label below */}
            <text
              x={pos.x}
              y={pos.y + r + 14}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--cm-fg-secondary)"
              fontSize="10"
            >
              {peer.name.length > 12
                ? peer.name.slice(0, 11) + "\u2026"
                : peer.name}
            </text>

            {/* Truncated summary below name */}
            {peer.summary && (
              <text
                x={pos.x}
                y={pos.y + r + 26}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--cm-fg-tertiary)"
                fontSize="8"
              >
                {peer.summary.length > 24
                  ? peer.summary.slice(0, 23) + "\u2026"
                  : peer.summary}
              </text>
            )}
          </g>
        );
      })}

      {/* Empty state */}
      {peers.length === 0 && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--cm-fg-tertiary)"
          fontSize="12"
        >
          No peers connected
        </text>
      )}
    </svg>
  );
};
