"use client";
import { useState } from "react";

interface Props {
  token: string;
}

const LAUNCH_CMD = (token: string) => `claudemesh launch --join ${token}`;
const INSTALL_AND_LAUNCH = (token: string) =>
  `npm i -g claudemesh-cli && claudemesh launch --join ${token}`;
const INSTALL_CMD = "npm i -g claudemesh-cli";

export const InstallToggle = ({ token }: Props) => {
  const [hasCli, setHasCli] = useState<"unknown" | "yes" | "no">("unknown");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (hasCli === "unknown") {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={() => setHasCli("no")}
          className="flex-1 rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5 text-left transition-colors hover:border-[var(--cm-clay)] hover:bg-[var(--cm-bg-hover)]"
        >
          <div
            className="mb-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            first time
          </div>
          <div
            className="text-lg font-medium text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Install claudemesh →
          </div>
        </button>
        <button
          onClick={() => setHasCli("yes")}
          className="flex-1 rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5 text-left transition-colors hover:border-[var(--cm-clay)] hover:bg-[var(--cm-bg-hover)]"
        >
          <div
            className="mb-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            already set up
          </div>
          <div
            className="text-lg font-medium text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Join with CLI →
          </div>
        </button>
      </div>
    );
  }

  if (hasCli === "yes") {
    const cmd = LAUNCH_CMD(token);
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-clay)]/40 bg-[var(--cm-bg-elevated)] p-5">
          <div
            className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            join + launch in one step
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 overflow-x-auto rounded-[var(--cm-radius-xs)] bg-[var(--cm-bg)] p-3 text-sm text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              {cmd}
            </code>
            <button
              onClick={() => copy(cmd, "join")}
              className="rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-4 py-3 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:bg-[var(--cm-clay-hover)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              {copiedKey === "join" ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
        <button
          onClick={() => setHasCli("unknown")}
          className="text-xs text-[var(--cm-fg-tertiary)] underline underline-offset-4 hover:text-[var(--cm-fg)]"
        >
          ← Need to install first?
        </button>
      </div>
    );
  }

  const oneLiner = INSTALL_AND_LAUNCH(token);
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-clay)]/40 bg-[var(--cm-bg-elevated)] p-5">
        <div
          className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          install + launch — one command
        </div>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 overflow-x-auto rounded-[var(--cm-radius-xs)] bg-[var(--cm-bg)] p-3 text-sm text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            {oneLiner}
          </code>
          <button
            onClick={() => copy(oneLiner, "one")}
            className="rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-4 py-3 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:bg-[var(--cm-clay-hover)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            {copiedKey === "one" ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <p
          className="mt-2 text-xs text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Requires Node.js 20+. Your display name defaults to <code style={{ fontFamily: "var(--cm-font-mono)" }}>$USER</code> — override with{" "}
          <code style={{ fontFamily: "var(--cm-font-mono)" }}>--name YourName</code>.
        </p>
      </div>
      <button
        onClick={() => setHasCli("unknown")}
        className="text-xs text-[var(--cm-fg-tertiary)] underline underline-offset-4 hover:text-[var(--cm-fg)]"
      >
        ← Back
      </button>
    </div>
  );
};
