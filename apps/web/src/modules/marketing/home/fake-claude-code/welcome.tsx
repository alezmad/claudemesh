import { Clawd, type ClawdPose } from "./clawd";
import { fccTheme } from "./theme";

type WelcomeProps = {
  pose?: ClawdPose;
  version?: string;
  model?: string;
  billing?: string;
  cwd?: string;
};

export function Welcome({
  pose = "default",
  version = "2.1.101",
  model = "Opus 4.6 (1M context)",
  billing = "Claude Max",
  cwd = "/Users/agutierrez",
}: WelcomeProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: "1ch",
        alignItems: "flex-start",
        fontFamily: fccTheme.fontMono,
        color: fccTheme.text,
        lineHeight: 1.15,
      }}
    >
      <div style={{ flexShrink: 0, paddingTop: "0.1em" }}>
        <Clawd pose={pose} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.05em",
          paddingTop: "0.1em",
        }}
      >
        <div>
          <span style={{ fontWeight: 700 }}>Claude Code</span>{" "}
          <span style={{ color: fccTheme.dim }}>v{version}</span>
        </div>
        <div style={{ color: fccTheme.dim }}>
          {model} · {billing}
        </div>
        <div style={{ color: fccTheme.dim }}>{cwd}</div>
      </div>
    </div>
  );
}
