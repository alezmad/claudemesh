import { fccTheme } from "./theme";

export type ClawdPose = "default" | "arms-up" | "look-left" | "look-right";

const APPLE_EYES: Record<ClawdPose, string> = {
  default: " \u2597   \u2596 ",
  "look-left": " \u2598   \u2598 ",
  "look-right": " \u259d   \u259d ",
  "arms-up": " \u2597   \u2596 ",
};

export function Clawd({ pose = "default" }: { pose?: ClawdPose }) {
  const monoStyle: React.CSSProperties = {
    fontFamily: fccTheme.fontMono,
    color: fccTheme.clawdBody,
    lineHeight: 1,
    letterSpacing: 0,
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0, "calt" 0',
    whiteSpace: "pre",
  };

  const eyesStyle: React.CSSProperties = {
    backgroundColor: fccTheme.clawdBody,
    color: fccTheme.clawdBackground,
  };

  const bodyRowStyle: React.CSSProperties = {
    backgroundColor: fccTheme.clawdBody,
    color: fccTheme.clawdBody,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        ...monoStyle,
      }}
      aria-label="Claude Code mascot"
    >
      <div>
        <span>{"\u2597"}</span>
        <span style={eyesStyle}>{APPLE_EYES[pose]}</span>
        <span>{"\u2596"}</span>
      </div>
      <div style={bodyRowStyle}>{"       "}</div>
      <div>{"\u2598\u2598 \u259d\u259d"}</div>
    </div>
  );
}
