"use client";

import { useState } from "react";

interface Props {
  userId: string;
  userEmail: string;
  userName: string;
}

const BROKER_URL = process.env.NEXT_PUBLIC_BROKER_HTTP_URL || "https://ic.claudemesh.com";

export function TokenGenerator({ userId, userEmail, userName }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/cli/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed" }));
        setError((body as { error?: string }).error ?? "Failed to generate token");
        return;
      }
      const { token: t } = (await res.json()) as { token: string };
      setToken(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text
      const el = document.getElementById("cli-token");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  }

  const btnBase = "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-[15px] font-medium transition-all";

  return (
    <div className="w-full max-w-[420px] space-y-6 p-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--cm-clay, #b07a56)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="4" r="2" fill="#fff" />
            <circle cx="4" cy="12" r="2" fill="#fff" />
            <circle cx="20" cy="12" r="2" fill="#fff" />
            <circle cx="12" cy="20" r="2" fill="#fff" />
            <path d="M12 4L4 12M12 4L20 12M4 12L12 20M20 12L12 20" stroke="#fff" strokeWidth="1.2" opacity="0.5" />
          </svg>
        </div>
        <h1 className="text-[22px] font-bold tracking-tight">CLI Token</h1>
        <p className="text-[14px]" style={{ color: "var(--cm-fg-muted, #888)" }}>
          Generate a token to sign in to claudemesh CLI.
          <br />
          Paste it in your terminal when prompted.
        </p>
      </div>

      {/* Signed in as */}
      <div className="text-center text-[13px]" style={{ color: "var(--cm-fg-muted, #888)" }}>
        Signed in as <strong style={{ color: "var(--cm-fg, #fafafa)" }}>{userName}</strong>
      </div>

      {!token ? (
        <>
          <button
            onClick={generate}
            disabled={loading}
            className={btnBase}
            style={{ background: "var(--cm-clay, #b07a56)", color: "#fff" }}
          >
            {loading ? "Generating…" : "Generate CLI token"}
          </button>
          {error && <p className="text-center text-[13px] text-red-400">{error}</p>}
        </>
      ) : (
        <div className="space-y-4">
          {/* Token display */}
          <div className="relative">
            <pre
              id="cli-token"
              className="w-full overflow-x-auto rounded-lg p-4 text-[12px] leading-relaxed break-all whitespace-pre-wrap"
              style={{ background: "var(--cm-bg-elevated, #1a1a1a)", border: "1px solid var(--cm-border, #333)", color: "var(--cm-fg, #fafafa)" }}
            >
              {token}
            </pre>
          </div>

          {/* Copy button */}
          <button
            onClick={copyToken}
            className={btnBase}
            style={{
              background: copied ? "#22c55e" : "var(--cm-clay, #b07a56)",
              color: "#fff",
            }}
          >
            {copied ? "✓ Copied!" : "Copy to clipboard"}
          </button>

          {/* Instructions */}
          <div className="rounded-lg p-4 text-[13px] space-y-2" style={{ background: "var(--cm-bg-elevated, #1a1a1a)", color: "var(--cm-fg-muted, #888)" }}>
            <p className="font-medium" style={{ color: "var(--cm-fg, #fafafa)" }}>Paste in your terminal:</p>
            <code className="block text-[12px]" style={{ color: "var(--cm-clay, #b07a56)" }}>
              claudemesh login → option 3 → paste
            </code>
          </div>

          {/* Security note */}
          <p className="text-center text-[11px]" style={{ color: "var(--cm-fg-muted, #666)" }}>
            This token grants CLI access to your account. Don&apos;t share it.
            <br />
            Valid for 30 days. Revoke anytime from Dashboard → Settings.
          </p>

          {/* Generate another */}
          <button
            onClick={() => { setToken(null); setCopied(false); }}
            className="w-full text-center text-[13px] underline"
            style={{ color: "var(--cm-fg-muted, #888)" }}
          >
            Generate a new token
          </button>
        </div>
      )}
    </div>
  );
}
