"use client";
import { useState } from "react";

interface Props {
  token: string;
}

const JOIN_CMD = (token: string) => `claudemesh join ${token}`;
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
    const cmd = JOIN_CMD(token);
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-clay)]/40 bg-[var(--cm-bg-elevated)] p-5">
          <div
            className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            run this in your terminal
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

  const joinCmd = JOIN_CMD(token);
  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        <li className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5">
          <div
            className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            <span className="rounded-full bg-[var(--cm-clay)]/20 px-1.5">1</span>
            install the CLI
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 overflow-x-auto rounded-[var(--cm-radius-xs)] bg-[var(--cm-bg)] p-3 text-sm text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              {INSTALL_CMD}
            </code>
            <button
              onClick={() => copy(INSTALL_CMD, "install")}
              className="rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] px-3 py-3 text-sm text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-fg)] hover:text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              {copiedKey === "install" ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p
            className="mt-2 text-xs text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Installs the CLI globally. Requires Node.js 20+.
          </p>
        </li>
        <li className="rounded-[var(--cm-radius-md)] border border-[var(--cm-clay)]/40 bg-[var(--cm-bg-elevated)] p-5">
          <div
            className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            <span className="rounded-full bg-[var(--cm-clay)]/20 px-1.5">2</span>
            join the mesh
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 overflow-x-auto rounded-[var(--cm-radius-xs)] bg-[var(--cm-bg)] p-3 text-sm text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              {joinCmd}
            </code>
            <button
              onClick={() => copy(joinCmd, "join")}
              className="rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-3 py-3 text-sm font-medium text-[var(--cm-fg)] transition-colors hover:bg-[var(--cm-clay-hover)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              {copiedKey === "join" ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </li>
        <li className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5">
          <div
            className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            <span className="rounded-full bg-[var(--cm-border)] px-1.5">3</span>
            launch with push messaging
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 overflow-x-auto rounded-[var(--cm-radius-xs)] bg-[var(--cm-bg)] p-3 text-sm text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              claudemesh launch --name YourName
            </code>
          </div>
          <p
            className="mt-2 text-xs text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Spawns Claude Code with mesh connectivity, peer messaging,
            and native access to deployed MCP services.
          </p>
        </li>
      </ol>
      <button
        onClick={() => setHasCli("unknown")}
        className="text-xs text-[var(--cm-fg-tertiary)] underline underline-offset-4 hover:text-[var(--cm-fg)]"
      >
        ← Back
      </button>
    </div>
  );
};
