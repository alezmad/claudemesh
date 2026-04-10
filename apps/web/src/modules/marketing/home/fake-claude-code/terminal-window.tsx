import type { ReactNode } from "react";
import { fccTheme } from "./theme";

type TerminalWindowProps = {
  title?: string;
  width?: number | string;
  height?: number | string;
  children: ReactNode;
};

export function TerminalWindow({
  title = "agutierrez — \u2728 Initialize new coding project — node · claude — 80\u00d724",
  width = 760,
  height = 520,
  children,
}: TerminalWindowProps) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow:
          "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
        backgroundColor: fccTheme.terminalBg,
        fontFamily: fccTheme.fontMono,
      }}
    >
      <TitleBar title={title} />
      <div
        style={{
          flex: 1,
          padding: "14px 18px 16px 18px",
          fontSize: 13,
          lineHeight: 1.45,
          color: fccTheme.text,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TitleBar({ title }: { title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 28,
        paddingInline: 12,
        backgroundColor: fccTheme.terminalChrome,
        borderBottom: "1px solid rgba(0,0,0,0.4)",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <TrafficLight color="#ff5f57" />
        <TrafficLight color="#febc2e" />
        <TrafficLight color="#28c840" />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 12,
          color: "rgba(255,255,255,0.85)",
          fontWeight: 600,
          pointerEvents: "none",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          height: "100%",
        }}
      >
        <FolderIcon />
        <span
          style={{
            maxWidth: "70%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </div>
    </div>
  );
}

function TrafficLight({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        backgroundColor: color,
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)",
      }}
    />
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 4.5a1 1 0 0 1 1-1h3.3l1.4 1.4h6.3a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5Z"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth="1.2"
      />
    </svg>
  );
}
