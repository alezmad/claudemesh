"use client";

import { useEffect, useRef, useState } from "react";
import { Session, type SessionEvent, type SessionStep } from "./session";
import { fccTheme } from "./theme";

type Point = { x: number; y: number };

type SessionConfig = {
  id: string;
  /** Display name used by mesh-send `to` fields to route particles */
  displayName: string;
  title: string;
  cwd: string;
  script: SessionStep[];
  startDelayMs?: number;
  position: {
    xPct: number;
    yPct: number;
    scale?: number;
    rotate?: number;
    opacity?: number;
    zIndex?: number;
    /** 0..1 — 1 is full color, 0 is grayscale */
    saturate?: number;
    /** pixels — adds depth-of-field bokeh blur to background peers */
    blurPx?: number;
  };
};

type ArcConfig = {
  fromId: string;
  toId: string;
  triggerStepKind: "mesh-send";
};

type FlyingParticle = {
  id: number;
  fromId: string;
  toId: string;
  bornAt: number;
};

type MeshHeroProps = {
  sessions: SessionConfig[];
  arcs?: ArcConfig[];
  width?: number;
  height?: number;
};

const PARTICLE_LIFE_MS = 1100;
const TRAIL_SEGMENTS = 18;
const TRAIL_SPAN = 0.34;
const ICON_W = 38;
const ICON_H = 26;

export function MeshHero({
  sessions,
  arcs = [],
  width = 1440,
  height = 720,
}: MeshHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<Record<string, Point>>({});
  const [particles, setParticles] = useState<FlyingParticle[]>([]);
  const particleIdRef = useRef(0);
  const [, forceTick] = useState(0);
  const [reactions, setReactions] = useState<
    Record<string, { nonce: number; kind: "receive" | "send" | "arrive" }>
  >({});
  const reactionTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const arrivedParticlesRef = useRef<Set<number>>(new Set());

  const bumpReaction = (
    sessionId: string,
    kind: "receive" | "send" | "arrive",
  ) => {
    setReactions((prev) => ({
      ...prev,
      [sessionId]: { nonce: (prev[sessionId]?.nonce ?? 0) + 1, kind },
    }));
  };

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      forceTick((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (particles.length === 0) return;
    const now = performance.now();
    const next = particles.filter((p) => now - p.bornAt < PARTICLE_LIFE_MS);
    if (next.length !== particles.length) setParticles(next);
  });

  const handleEvent = (e: SessionEvent) => {
    if (e.kind !== "mesh-send") return;
    // Resolve destination by matching the mesh-send `to` field against
    // session displayNames. Fall back to the configured arcs if provided.
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = normalize(e.to);
    const toSession = sessions.find(
      (s) => normalize(s.displayName) === target,
    );
    let fromId = e.sessionId;
    let toId = toSession?.id;
    if (!toId) {
      const arc = arcs.find((a) => a.fromId === e.sessionId);
      if (!arc) return;
      toId = arc.toId;
    }
    if (fromId === toId) return;
    bumpReaction(fromId, "send");
    const id = particleIdRef.current++;
    setParticles((prev) => [
      ...prev,
      {
        id,
        fromId,
        toId,
        bornAt: performance.now(),
      },
    ]);
    const timer = setTimeout(
      () => bumpReaction(toId!, "arrive"),
      PARTICLE_LIFE_MS - 60,
    );
    reactionTimersRef.current[`${id}`] = timer;
  };

  useEffect(() => {
    return () => {
      Object.values(reactionTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  const setAnchor = (id: string) => (el: HTMLDivElement | null) => {
    if (!el || !containerRef.current) return;
    const container = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    anchorsRef.current[id] = {
      x: rect.left - container.left + rect.width / 2,
      y: rect.top - container.top + rect.height / 2,
    };
  };

  const arcForParticle = (fromId: string, toId: string) => {
    const from = anchorsRef.current[fromId];
    const to = anchorsRef.current[toId];
    if (!from || !to) return null;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - Math.abs(to.x - from.x) * 0.08 - 30;
    return { from, to, midX, midY };
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width,
        height,
        background:
          "radial-gradient(ellipse at 50% 40%, rgba(215,119,87,0.07) 0%, rgba(0,0,0,0) 55%), #0a0a0a",
        overflow: "hidden",
      }}
    >
      {sessions.map((s) => {
        const left = (s.position.xPct / 100) * width;
        const top = (s.position.yPct / 100) * height;
        const scale = s.position.scale ?? 1;
        const rotate = s.position.rotate ?? 0;
        const opacity = s.position.opacity ?? 1;
        const zIndex = s.position.zIndex ?? 1;
        const saturate = s.position.saturate ?? 1;
        const blurPx = s.position.blurPx ?? 0;
        const filters = [
          "drop-shadow(0 30px 50px rgba(0,0,0,0.6))",
          saturate !== 1 ? `saturate(${saturate})` : "",
          blurPx > 0 ? `blur(${blurPx}px)` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={s.id}
            ref={setAnchor(s.id)}
            style={{
              position: "absolute",
              left,
              top,
              transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotate}deg)`,
              transformOrigin: "center center",
              filter: filters,
              opacity,
              zIndex,
            }}
          >
            <Session
              sessionId={s.id}
              script={s.script}
              title={s.title}
              cwd={s.cwd}
              width={720}
              height={480}
              startDelayMs={s.startDelayMs}
              onEvent={handleEvent}
              reactionNonce={reactions[s.id]?.nonce ?? 0}
              reactionKind={reactions[s.id]?.kind ?? "receive"}
            />
          </div>
        );
      })}

      <svg
        width={width}
        height={height}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          mixBlendMode: "screen",
        }}
      >
        <defs>
          <filter id="meshGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <symbol id="meshMsgIcon" viewBox="0 0 38 26">
            <rect
              x="1.5"
              y="1.5"
              width="35"
              height="23"
              rx="3"
              ry="3"
              fill={fccTheme.clawdBody}
              stroke={fccTheme.claudeShimmer}
              strokeWidth="1"
            />
            <path
              d="M 4 5 L 19 15 L 34 5"
              stroke={fccTheme.clawdBackground}
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </symbol>
        </defs>
        {particles.map((p) => {
          const arc = arcForParticle(p.fromId, p.toId);
          if (!arc) return null;
          const age = (performance.now() - p.bornAt) / PARTICLE_LIFE_MS;
          if (age > 1) return null;
          const head = Math.min(1, Math.max(0, age));

          const pointAt = (t: number) => {
            const tt = Math.max(0, Math.min(1, t));
            const inv = 1 - tt;
            return {
              x:
                inv * inv * arc.from.x +
                2 * inv * tt * arc.midX +
                tt * tt * arc.to.x,
              y:
                inv * inv * arc.from.y +
                2 * inv * tt * arc.midY +
                tt * tt * arc.to.y,
            };
          };

          const trailNodes = Array.from({ length: TRAIL_SEGMENTS }, (_, i) => {
            const frac = i / TRAIL_SEGMENTS;
            const t = head - frac * TRAIL_SPAN;
            if (t < 0) return null;
            const pt = pointAt(t);
            const falloff = Math.pow(1 - frac, 2.2);
            return {
              x: pt.x,
              y: pt.y,
              r: 2 + falloff * 5,
              opacity: 0.75 * falloff,
            };
          }).filter((n): n is NonNullable<typeof n> => n !== null);

          const headPt = pointAt(head);
          const iconOpacity = Math.min(1, Math.sin(head * Math.PI) * 1.2 + 0.15);

          return (
            <g key={p.id} filter="url(#meshGlow)">
              {trailNodes.map((n, i) => (
                <circle
                  key={i}
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={fccTheme.clawdBody}
                  opacity={n.opacity}
                />
              ))}
              <use
                href="#meshMsgIcon"
                x={headPt.x - ICON_W / 2}
                y={headPt.y - ICON_H / 2}
                width={ICON_W}
                height={ICON_H}
                opacity={iconOpacity}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
