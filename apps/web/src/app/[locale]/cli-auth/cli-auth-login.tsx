"use client";

import { useState } from "react";
import { authClient } from "~/lib/auth/client";

interface Props {
  code: string;
}

export function CliAuthLogin({ code }: Props) {
  const redirectTo = `/cli-auth?code=${encodeURIComponent(code)}`;
  const [loading, setLoading] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");

  const handleSocial = async (provider: "google" | "github") => {
    setLoading(provider);
    setError("");
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: redirectTo,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setLoading(null);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading("email");
    setError("");
    try {
      if (mode === "register") {
        await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0] || "User",
          callbackURL: redirectTo,
        });
      } else {
        await authClient.signIn.email({
          email,
          password,
          callbackURL: redirectTo,
        });
      }
      window.location.href = redirectTo;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setLoading(null);
    }
  };

  const btnBase = "w-full flex items-center justify-center gap-3 rounded-lg px-4 py-3 text-[15px] font-medium transition-all";
  const btnOutline = `${btnBase} border border-[var(--cm-border,#333)] text-[var(--cm-fg,#fafafa)] hover:bg-[var(--cm-bg-elevated,#1a1a1a)]`;
  const btnPrimary = `${btnBase} bg-[var(--cm-clay,#b07a56)] text-[var(--cm-fg,#fafafa)] hover:opacity-90`;
  const inputBase = "w-full rounded-lg border border-[var(--cm-border,#333)] bg-[var(--cm-bg,#0a0a0a)] px-4 py-3 text-[15px] text-[var(--cm-fg,#fafafa)] placeholder:text-[var(--cm-fg-muted,#666)] focus:outline-none focus:ring-2 focus:ring-[var(--cm-clay,#b07a56)]/50 focus:border-[var(--cm-clay,#b07a56)]";

  return (
    <div className="w-full max-w-[400px] space-y-6 p-8">
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
        <h1 className="text-[22px] font-bold tracking-tight">
          Connect to claudemesh CLI
        </h1>
        <p className="text-[14px]" style={{ color: "var(--cm-fg-muted, #888)" }}>
          {mode === "login" ? "Sign in" : "Create an account"} to connect your terminal session.
        </p>
      </div>

      {/* Social buttons */}
      <div className="space-y-2.5">
        <button onClick={() => handleSocial("google")} disabled={!!loading} className={btnOutline}>
          {loading === "google" ? (
            <span className="animate-spin">⟳</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          )}
          Continue with Google
        </button>
        <button onClick={() => handleSocial("github")} disabled={!!loading} className={btnOutline}>
          {loading === "github" ? (
            <span className="animate-spin">⟳</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 011.3-3.3c-.2-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 3 .1 3.3a4.7 4.7 0 011.3 3.3c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3"/></svg>
          )}
          Continue with GitHub
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px" style={{ background: "var(--cm-border, #333)" }} />
        <span className="text-[12px] uppercase tracking-wider" style={{ color: "var(--cm-fg-muted, #666)" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "var(--cm-border, #333)" }} />
      </div>

      {/* Email form */}
      <form onSubmit={handleEmailSubmit} className="space-y-3">
        {mode === "register" && (
          <input type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)} className={inputBase} />
        )}
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className={inputBase} />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} className={inputBase} />

        {error && <p className="text-[13px] text-red-400">{error}</p>}

        <button type="submit" disabled={!!loading} className={btnPrimary}>
          {loading === "email" ? "..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      {/* Toggle mode */}
      <p className="text-center text-[13px]" style={{ color: "var(--cm-fg-muted, #888)" }}>
        {mode === "login" ? (
          <>Don&apos;t have an account?{" "}<button onClick={() => { setMode("register"); setError(""); }} className="underline hover:text-[var(--cm-fg)]">Register</button></>
        ) : (
          <>Already have an account?{" "}<button onClick={() => { setMode("login"); setError(""); }} className="underline hover:text-[var(--cm-fg)]">Sign in</button></>
        )}
      </p>

      {/* Device code */}
      <div className="pt-2 text-center">
        <div className="inline-block rounded-lg px-5 py-2.5 font-mono text-lg tracking-[0.25em]" style={{ background: "var(--cm-bg-elevated, #1a1a1a)", border: "1px solid var(--cm-border, #333)" }}>
          {code}
        </div>
        <p className="mt-2 text-[12px]" style={{ color: "var(--cm-fg-muted, #666)" }}>
          Confirm this code matches your terminal
        </p>
      </div>
    </div>
  );
}
