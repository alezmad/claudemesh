import type { ReactNode } from "react";
import { fccTheme } from "./theme";

type BaseProps = { children: ReactNode };

export function UserPromptRow({ children }: BaseProps) {
  return (
    <div style={{ display: "flex", gap: "1ch", marginTop: 6 }}>
      <span style={{ color: fccTheme.dim }}>{"\u003e"}</span>
      <span style={{ color: fccTheme.text }}>{children}</span>
    </div>
  );
}

export function BashRunRow({
  command,
  lines,
}: {
  command: string;
  lines?: string[];
}) {
  return (
    <div style={{ marginTop: 10, marginBottom: 6 }}>
      <div style={{ display: "flex", gap: "0.7ch", alignItems: "baseline" }}>
        <span style={{ color: fccTheme.success }}>{"\u25cf"}</span>
        <span style={{ fontWeight: 700 }}>Bash</span>
        <span style={{ color: fccTheme.dim }}>({command})</span>
      </div>
      {lines?.map((l, i) => (
        <div
          key={i}
          style={{
            paddingLeft: "2.2ch",
            color: fccTheme.dim,
          }}
        >
          <span style={{ color: fccTheme.subtle, marginRight: "0.7ch" }}>
            {"\u2514"}
          </span>
          {l}
        </div>
      ))}
    </div>
  );
}

export function BulletRow({
  color = "success",
  children,
}: {
  color?: "success" | "error" | "dim";
  children: ReactNode;
}) {
  const c =
    color === "error"
      ? fccTheme.error
      : color === "dim"
      ? fccTheme.dim
      : fccTheme.success;
  return (
    <div style={{ display: "flex", gap: "0.7ch", marginTop: 8 }}>
      <span style={{ color: c }}>{"\u25cf"}</span>
      <span>{children}</span>
    </div>
  );
}

export function ToolUseRow({
  name,
  args,
  result,
}: {
  name: string;
  args?: string;
  result?: string;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: "0.7ch" }}>
        <span style={{ color: fccTheme.clawdBody }}>{"\u25cf"}</span>
        <span style={{ fontWeight: 700 }}>{name}</span>
        {args && <span style={{ color: fccTheme.dim }}>({args})</span>}
      </div>
      {result && (
        <div style={{ paddingLeft: "2.2ch", color: fccTheme.dim }}>
          <span style={{ color: fccTheme.subtle, marginRight: "0.7ch" }}>
            {"\u2514"}
          </span>
          {result}
        </div>
      )}
    </div>
  );
}

export function AssistantTextRow({ children }: BaseProps) {
  return (
    <div style={{ marginTop: 8, color: fccTheme.text }}>
      <span style={{ color: fccTheme.clawdBody, marginRight: "0.7ch" }}>
        {"\u25cf"}
      </span>
      {children}
    </div>
  );
}

export function MeshMessageRow({
  direction,
  peer,
  message,
}: {
  direction: "out" | "in";
  peer: string;
  message: string;
}) {
  const arrow = direction === "out" ? "\u2192" : "\u2190";
  return (
    <div
      style={{
        marginTop: 8,
        padding: "6px 10px",
        border: `1px solid ${fccTheme.clawdBody}`,
        borderRadius: 4,
        color: fccTheme.text,
        display: "flex",
        gap: "0.7ch",
        alignItems: "baseline",
      }}
    >
      <span style={{ color: fccTheme.clawdBody }}>mesh</span>
      <span style={{ color: fccTheme.dim }}>{arrow}</span>
      <span style={{ color: fccTheme.clawdBody, fontWeight: 700 }}>
        {peer}
      </span>
      <span style={{ color: fccTheme.dim }}>:</span>
      <span>{message}</span>
    </div>
  );
}
