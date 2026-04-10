import { fccTheme } from "./theme";

type StatusBarProps = {
  user?: string;
  cwd?: string;
  model?: string;
  contextPct?: number;
  errorNote?: string;
  errorAction?: string;
};

export function StatusBar({
  user = "agutierrez@Mac",
  cwd = "~",
  model = "Opus 4.6 (1M context)",
  contextPct = 6,
  errorNote,
  errorAction,
}: StatusBarProps) {
  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 8,
        borderTop: `1px solid ${fccTheme.subtle}`,
        display: "flex",
        justifyContent: "space-between",
        color: fccTheme.dim,
        fontSize: "inherit",
      }}
    >
      <div>
        <span>{user}</span>
        <span style={{ margin: "0 0.7ch" }}>{"\u007c"}</span>
        <span>{cwd}</span>
        <span style={{ margin: "0 0.7ch" }}>{"\u007c"}</span>
        <span>{model}</span>
        <span style={{ marginLeft: "0.7ch" }}>{`[ctx:${contextPct}%]`}</span>
      </div>
      {errorNote && (
        <div>
          <span style={{ color: fccTheme.error }}>{errorNote}</span>
          {errorAction && (
            <>
              <span style={{ color: fccTheme.dim, margin: "0 0.7ch" }}>
                {"\u00b7"}
              </span>
              <span style={{ color: fccTheme.clawdBody }}>{errorAction}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
