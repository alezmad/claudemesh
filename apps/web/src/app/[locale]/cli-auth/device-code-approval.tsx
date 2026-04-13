"use client";

import { useEffect, useState, useRef } from "react";

interface Props {
  code: string;
  userName: string;
}

export function DeviceCodeApproval({ code, userName }: Props) {
  const [status, setStatus] = useState<"approving" | "done" | "error">("approving");
  const [error, setError] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // Auto-approve on mount — user is already authenticated
    fetch("/api/auth/cli/device-code/approve-by-user-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ user_code: code }),
    })
      .then(async (res) => {
        if (res.ok) {
          setStatus("done");
        } else {
          const body = await res.json().catch(() => ({ error: "Unknown error" }));
          setError((body as { error?: string }).error ?? `Error ${res.status}`);
          setStatus("error");
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Network error");
        setStatus("error");
      });
  }, [code]);

  return (
    <div className="w-full max-w-md text-center space-y-6 p-8">
      <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
        style={{ background: "var(--cm-accent, #f97316)" }}>
        {status === "done" ? "✓" : status === "error" ? "!" : "⟳"}
      </div>

      {status === "approving" && (
        <>
          <h1 className="text-2xl font-bold">Connecting your terminal…</h1>
          <p className="text-sm" style={{ color: "var(--cm-fg-muted, #888)" }}>
            Signing in as {userName}
          </p>
        </>
      )}

      {status === "done" && (
        <>
          <h1 className="text-2xl font-bold">Connected!</h1>
          <p style={{ color: "var(--cm-fg-muted, #888)" }}>
            Signed in as <strong>{userName}</strong>
          </p>
          <p className="text-sm" style={{ color: "var(--cm-fg-muted, #888)" }}>
            You can close this tab and return to your terminal.
          </p>
        </>
      )}

      {status === "error" && (
        <>
          <h1 className="text-2xl font-bold">Connection failed</h1>
          <p style={{ color: "#ef4444" }}>
            {error || "Something went wrong."}
          </p>
          <p className="text-sm" style={{ color: "var(--cm-fg-muted, #888)" }}>
            Run <code className="px-1.5 py-0.5 rounded" style={{ background: "var(--cm-bg-muted, #1a1a1a)" }}>claudemesh login</code> again in your terminal.
          </p>
        </>
      )}

      <div className="pt-4">
        <div className="rounded-lg p-3 font-mono text-sm tracking-wider"
          style={{ background: "var(--cm-bg-muted, #1a1a1a)", color: "var(--cm-fg-muted, #888)" }}>
          Device code: {code}
        </div>
      </div>
    </div>
  );
}
