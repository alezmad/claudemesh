"use client";

import { useEffect, useState } from "react";
import { fccTheme } from "./theme";

const FRAMES = ["\u2847", "\u284f", "\u285f", "\u287f", "\u28ff", "\u28f7", "\u28e7", "\u28c7"];

type ThinkingSpinnerProps = {
  label?: string;
  intervalMs?: number;
};

export function ThinkingSpinner({
  label = "Thinking",
  intervalMs = 80,
}: ThinkingSpinnerProps) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return (
    <div style={{ display: "flex", gap: "0.6ch", color: fccTheme.claudeShimmer }}>
      <span style={{ color: fccTheme.clawdBody }}>{FRAMES[i]}</span>
      <span style={{ color: fccTheme.dim, fontStyle: "italic" }}>{label}…</span>
    </div>
  );
}
