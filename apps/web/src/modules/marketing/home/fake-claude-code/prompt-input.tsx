import { fccTheme } from "./theme";

type PromptInputProps = {
  value?: string;
  caret?: boolean;
};

export function PromptInput({ value = "", caret = true }: PromptInputProps) {
  return (
    <div
      style={{
        marginTop: 12,
        border: `1px solid ${fccTheme.promptBorder}`,
        borderRadius: 4,
        padding: "6px 10px",
        color: fccTheme.text,
        display: "flex",
        alignItems: "baseline",
        gap: "0.7ch",
      }}
    >
      <span style={{ color: fccTheme.dim }}>{"\u003e"}</span>
      <span>{value}</span>
      {caret && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: "0.6ch",
            height: "1em",
            backgroundColor: fccTheme.text,
            animation: "fccCaret 1s steps(1) infinite",
          }}
        />
      )}
      <style>{`@keyframes fccCaret { 50% { opacity: 0; } }`}</style>
    </div>
  );
}
