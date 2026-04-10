"use client";

import { useEffect, useRef, useState } from "react";
import { MeshHero } from "./fake-claude-code/mesh-hero";
import type { SessionStep } from "./fake-claude-code/session";

const NATURAL_W = 1600;
const NATURAL_H = 860;

const SCRIPT_A: SessionStep[] = [
  { type: "pause", durationMs: 400 },
  { type: "user-input", text: "share_skill /review-pr" },
  { type: "mesh-send", to: "Lug Nut", message: "share_skill /review-pr" },
  { type: "pause", durationMs: 1200 },
  { type: "mesh-receive", from: "Mou", message: "postgres-prod MCP live" },
  { type: "pause", durationMs: 800 },
  {
    type: "tool-use",
    name: "mesh_tool_call",
    args: "postgres-prod.query",
    result: "142 rows",
  },
  { type: "pause", durationMs: 1100 },
  { type: "mesh-send", to: "Mou", message: "thanks — skill in use" },
  { type: "pause", durationMs: 2200 },
];

const SCRIPT_B: SessionStep[] = [
  { type: "pause", durationMs: 700 },
  { type: "mesh-receive", from: "Alexis", message: "/review-pr shared" },
  { type: "pause", durationMs: 800 },
  { type: "user-input", text: "/review-pr PR #142" },
  { type: "thinking", durationMs: 700 },
  {
    type: "tool-use",
    name: "Read",
    args: "auth/middleware.ts",
    result: "142 lines",
  },
  { type: "pause", durationMs: 800 },
  { type: "mesh-send", to: "Mou", message: "found 2 issues in auth flow" },
  { type: "pause", durationMs: 1500 },
  { type: "mesh-receive", from: "Alexis", message: "thanks — skill in use" },
  { type: "pause", durationMs: 1600 },
];

const SCRIPT_C: SessionStep[] = [
  { type: "pause", durationMs: 300 },
  { type: "user-input", text: "expose postgres to mesh" },
  {
    type: "tool-use",
    name: "mesh_mcp_deploy",
    args: "postgres-prod",
    result: "exposed to 6 peers",
  },
  { type: "mesh-send", to: "Alexis", message: "postgres-prod MCP live" },
  { type: "pause", durationMs: 1400 },
  {
    type: "mesh-receive",
    from: "Lug Nut",
    message: "found 2 issues in auth flow",
  },
  { type: "pause", durationMs: 700 },
  { type: "assistant-text", text: "Patching issues via mesh." },
  { type: "pause", durationMs: 900 },
  {
    type: "mesh-send",
    to: "Lug Nut",
    message: "fix pushed — rerun /review-pr",
  },
  { type: "pause", durationMs: 1800 },
];

const SCRIPT_PIP: SessionStep[] = [
  { type: "pause", durationMs: 1200 },
  { type: "mesh-receive", from: "Alexis", message: "share_skill /review-pr" },
  { type: "pause", durationMs: 1600 },
  { type: "mesh-send", to: "Alexis", message: "cache warm" },
  { type: "pause", durationMs: 3200 },
];

const SCRIPT_RIPPLE: SessionStep[] = [
  { type: "pause", durationMs: 2100 },
  { type: "mesh-receive", from: "Mou", message: "postgres-prod MCP live" },
  { type: "pause", durationMs: 1800 },
  { type: "mesh-send", to: "Mou", message: "mirror ready" },
  { type: "pause", durationMs: 3000 },
];

const SCRIPT_NEBULA: SessionStep[] = [
  { type: "pause", durationMs: 2800 },
  { type: "mesh-receive", from: "Lug Nut", message: "need security review" },
  { type: "pause", durationMs: 1500 },
  { type: "mesh-send", to: "Lug Nut", message: "reviewed — LGTM" },
  { type: "pause", durationMs: 3000 },
];

const SCRIPT_JET: SessionStep[] = [
  { type: "pause", durationMs: 1800 },
  { type: "mesh-receive", from: "Alexis", message: "thanks — skill in use" },
  { type: "pause", durationMs: 1800 },
  { type: "mesh-send", to: "Alexis", message: "heartbeat ok" },
  { type: "pause", durationMs: 3200 },
];

const SCRIPT_VELA: SessionStep[] = [
  { type: "pause", durationMs: 900 },
  { type: "mesh-send", to: "Lug Nut", message: "broker uptime 99.98" },
  { type: "pause", durationMs: 2400 },
  { type: "mesh-receive", from: "Mou", message: "postgres-prod MCP live" },
  { type: "pause", durationMs: 3400 },
];

const SCRIPT_OREL: SessionStep[] = [
  { type: "pause", durationMs: 2400 },
  { type: "mesh-receive", from: "Alexis", message: "share_skill /review-pr" },
  { type: "pause", durationMs: 1600 },
  { type: "mesh-send", to: "Alexis", message: "mirrored downstream" },
  { type: "pause", durationMs: 3000 },
];

type HeroMeshAnimationProps = {
  /**
   * `cover` — fill both width and height of the parent, overflow clipped (for
   * use as a hero background). `contain` — fit within width, height scales
   * proportionally (standalone use).
   */
  fit?: "cover" | "contain";
};

export function HeroMeshAnimation({ fit = "contain" }: HeroMeshAnimationProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const compute = (w: number, h: number) => {
      if (fit === "cover") {
        // Pick the larger ratio so the composition fills both dimensions.
        // Never scale below 1 in cover mode — we want overflow if the parent
        // is smaller than the natural size.
        const s = Math.max(w / NATURAL_W, h / NATURAL_H);
        setFitScale(Math.max(s, 0.001));
      } else {
        setFitScale(Math.min(1, w / NATURAL_W));
      }
    };
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      compute(rect.width, rect.height);
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    compute(rect.width, rect.height);
    return () => ro.disconnect();
  }, [fit]);

  const isCover = fit === "cover";
  const scaledW = NATURAL_W * fitScale;
  const scaledH = NATURAL_H * fitScale;

  return (
    <div
      ref={outerRef}
      className={isCover ? "h-full w-full" : "w-full"}
      style={{
        overflow: "hidden",
        position: "relative",
        ...(isCover ? {} : { height: scaledH }),
      }}
    >
      <div
        style={{
          width: scaledW,
          height: scaledH,
          ...(isCover
            ? {
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
              }
            : { margin: "0 auto" }),
        }}
      >
        <div
          style={{
            width: NATURAL_W,
            height: NATURAL_H,
            transform: `scale(${fitScale})`,
            transformOrigin: "top left",
          }}
        >
          <MeshHero
            width={NATURAL_W}
            height={NATURAL_H}
            sessions={[
          {
            id: "P_VELA",
            displayName: "Vela",
            title: "vela · claude — 80\u00d724",
            cwd: "~/broker",
            script: SCRIPT_VELA,
            position: {
              xPct: 50,
              yPct: 10,
              scale: 0.38,
              opacity: 0.55,
              saturate: 0.35,
              blurPx: 0.6,
              zIndex: 0,
            },
          },
          {
            id: "P_OREL",
            displayName: "Orel",
            title: "orel · claude — 80\u00d724",
            cwd: "~/registry",
            script: SCRIPT_OREL,
            position: {
              xPct: 50,
              yPct: 88,
              scale: 0.38,
              opacity: 0.55,
              saturate: 0.35,
              blurPx: 0.6,
              zIndex: 0,
            },
          },
          {
            id: "P1",
            displayName: "Pip",
            title: "pip · claude — 80\u00d724",
            cwd: "~/tools",
            script: SCRIPT_PIP,
            position: {
              xPct: 8,
              yPct: 20,
              scale: 0.42,
              rotate: -4,
              opacity: 0.6,
              saturate: 0.4,
              blurPx: 0.5,
              zIndex: 0,
            },
          },
          {
            id: "P2",
            displayName: "Ripple",
            title: "ripple · claude — 80\u00d724",
            cwd: "~/infra",
            script: SCRIPT_RIPPLE,
            position: {
              xPct: 92,
              yPct: 20,
              scale: 0.42,
              rotate: 4,
              opacity: 0.6,
              saturate: 0.4,
              blurPx: 0.5,
              zIndex: 0,
            },
          },
          {
            id: "P3",
            displayName: "Nebula",
            title: "nebula · claude — 80\u00d724",
            cwd: "~/ops",
            script: SCRIPT_NEBULA,
            position: {
              xPct: 10,
              yPct: 82,
              scale: 0.4,
              rotate: 3,
              opacity: 0.58,
              saturate: 0.38,
              blurPx: 0.5,
              zIndex: 0,
            },
          },
          {
            id: "P4",
            displayName: "Jet",
            title: "jet · claude — 80\u00d724",
            cwd: "~/monorepo",
            script: SCRIPT_JET,
            position: {
              xPct: 90,
              yPct: 82,
              scale: 0.4,
              rotate: -3,
              opacity: 0.58,
              saturate: 0.38,
              blurPx: 0.5,
              zIndex: 0,
            },
          },
          {
            id: "A",
            displayName: "Alexis",
            title: "agutierrez — alexis · claude — 80\u00d724",
            cwd: "~/claudemesh",
            script: SCRIPT_A,
            position: {
              xPct: 20,
              yPct: 58,
              scale: 0.65,
              rotate: -3,
              saturate: 1,
              opacity: 1,
              zIndex: 2,
            },
          },
          {
            id: "B",
            displayName: "Lug Nut",
            title: "agutierrez — lug-nut · claude — 80\u00d724",
            cwd: "~/whyrating",
            script: SCRIPT_B,
            position: {
              xPct: 50,
              yPct: 40,
              scale: 0.65,
              rotate: 0,
              saturate: 1,
              opacity: 1,
              zIndex: 2,
            },
          },
          {
            id: "C",
            displayName: "Mou",
            title: "agutierrez — mou · claude — 80\u00d724",
            cwd: "~/mineryreport",
            script: SCRIPT_C,
            position: {
              xPct: 80,
              yPct: 58,
              scale: 0.65,
              rotate: 3,
              saturate: 1,
              opacity: 1,
              zIndex: 2,
            },
          },
        ]}
          />
        </div>
      </div>
    </div>
  );
}
