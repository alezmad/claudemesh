"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState, useRef } from "react";

import { getMyMeshesResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Mesh {
  id: string;
  name: string;
  slug: string;
  myRole: "admin" | "member";
  isOwner: boolean;
  memberCount: number;
}

interface Props {
  code: string | null;
  port: string | null;
  userId: string;
  userEmail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const ease = [0.22, 0.61, 0.36, 1] as const;

// ---------------------------------------------------------------------------
// Animated mesh node background
// ---------------------------------------------------------------------------

function MeshBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Radial glow */}
      <div
        className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 50% 0%, var(--cm-clay) 0%, transparent 70%)",
        }}
      />
      {/* Floating mesh nodes */}
      {[
        { x: "12%", y: "18%", delay: 0, size: 3 },
        { x: "85%", y: "14%", delay: 1.2, size: 2 },
        { x: "72%", y: "55%", delay: 0.6, size: 4 },
        { x: "8%", y: "65%", delay: 2.0, size: 2 },
        { x: "45%", y: "80%", delay: 0.3, size: 3 },
        { x: "92%", y: "78%", delay: 1.8, size: 2 },
      ].map((node, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-[var(--cm-clay)]"
          style={{
            left: node.x,
            top: node.y,
            width: node.size,
            height: node.size,
          }}
          animate={{
            opacity: [0.15, 0.4, 0.15],
            scale: [1, 1.5, 1],
          }}
          transition={{
            duration: 4,
            ease: "easeInOut",
            repeat: Infinity,
            delay: node.delay,
          }}
        />
      ))}
      {/* Connecting lines (SVG) */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.04]">
        <line
          x1="12%"
          y1="18%"
          x2="45%"
          y2="80%"
          stroke="var(--cm-clay)"
          strokeWidth="1"
        />
        <line
          x1="85%"
          y1="14%"
          x2="72%"
          y2="55%"
          stroke="var(--cm-clay)"
          strokeWidth="1"
        />
        <line
          x1="72%"
          y1="55%"
          x2="92%"
          y2="78%"
          stroke="var(--cm-clay)"
          strokeWidth="1"
        />
        <line
          x1="8%"
          y1="65%"
          x2="45%"
          y2="80%"
          stroke="var(--cm-clay)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal-style status indicator
// ---------------------------------------------------------------------------

function StatusPulse({ status }: { status: "waiting" | "syncing" | "done" | "error" }) {
  const colors = {
    waiting: "bg-[var(--cm-clay)]",
    syncing: "bg-amber-400",
    done: "bg-emerald-400",
    error: "bg-red-400",
  };
  return (
    <span className="relative inline-flex h-2 w-2">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${colors[status]}`}
      />
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${colors[status]}`}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CliAuthFlow({ code, port, userId, userEmail }: Props) {
  const [meshes, setMeshes] = useState<Mesh[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [redirected, setRedirected] = useState(false);

  // Create-mesh form state
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-slug from name
  useEffect(() => {
    if (!slugDirty && newName) {
      setNewSlug(slugify(newName));
    }
  }, [newName, slugDirty]);

  // Fetch user meshes
  useEffect(() => {
    (async () => {
      try {
        const { data } = await handle(api.my.meshes.$get, {
          schema: getMyMeshesResponseSchema,
        })({
          query: { page: "1", perPage: "50", sort: JSON.stringify([]) },
        });
        setMeshes(data);
        setSelected(new Set(data.map((m) => m.id)));
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load your meshes.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Auto-focus name input when no meshes
  useEffect(() => {
    if (!loading && meshes.length === 0 && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [loading, meshes.length]);

  const toggleMesh = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const status = token
    ? redirected
      ? "done"
      : "done"
    : syncing || creating
      ? "syncing"
      : error
        ? "error"
        : "waiting";

  // ---------------------------------------------------------------------------
  // Create mesh
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const createRes = await fetch("/api/my/meshes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newName.trim(),
          slug: newSlug.trim(),
          visibility: "private",
          transport: "managed",
        }),
      });
      const res = (await createRes.json()) as
        | { id: string; slug: string }
        | { error: string };
      if (!createRes.ok || "error" in res) {
        setCreateError("error" in res ? res.error : "Failed to create mesh.");
        setCreating(false);
        return;
      }
      await doSync(
        [{ id: res.id, slug: res.slug, role: "admin" as const }],
        "create",
        { name: newName.trim(), slug: newSlug.trim() },
      );
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create mesh.");
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Sync flow
  // ---------------------------------------------------------------------------

  const doSync = async (
    meshList: Array<{ id: string; slug: string; role: string }>,
    action: "sync" | "create" = "sync",
    newMesh?: { name: string; slug: string },
  ) => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/cli-sync-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ meshes: meshList, action, newMesh }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to generate token.");
        setSyncing(false);
        return;
      }
      const jwt = data.token as string;
      setToken(jwt);
      if (port) {
        setRedirected(true);
        window.location.href = `http://localhost:${port}/callback?token=${encodeURIComponent(jwt)}`;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate sync token.");
    } finally {
      setSyncing(false);
    }
  };

  const handleSync = () => {
    const selectedMeshes = meshes
      .filter((m) => selected.has(m.id))
      .map((m) => ({
        id: m.id,
        slug: m.slug,
        role: m.isOwner ? "admin" : m.myRole,
      }));
    if (selectedMeshes.length === 0) {
      setError("Select at least one mesh to sync.");
      return;
    }
    doSync(selectedMeshes, "sync");
  };

  const handleCopy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Header */}
      <header className="relative z-20 border-b border-[var(--cm-border)] px-6 py-5 md:px-12">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="claudemesh home"
            className="group flex w-fit items-center gap-2.5"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              className="text-[var(--cm-clay)] transition-transform duration-300 group-hover:rotate-180"
            >
              <circle cx="12" cy="4" r="2" fill="currentColor" />
              <circle cx="4" cy="12" r="2" fill="currentColor" />
              <circle cx="20" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="20" r="2" fill="currentColor" />
              <path
                d="M12 4L4 12M12 4L20 12M4 12L12 20M20 12L12 20M4 12L20 12M12 4L12 20"
                stroke="currentColor"
                strokeWidth="1.2"
                opacity="0.45"
              />
            </svg>
            <span
              className="text-[17px] font-medium tracking-tight"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              claudemesh
            </span>
          </Link>

          {/* Status indicator */}
          <div
            className="flex items-center gap-2 text-xs text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            <StatusPulse status={status} />
            <span>
              {status === "waiting" && "awaiting sync"}
              {status === "syncing" && "generating token..."}
              {status === "done" && "synced"}
              {status === "error" && "error"}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 mx-auto w-full max-w-2xl px-6 py-16 md:px-12 md:py-24">
        <MeshBackdrop />

        {/* Section tag */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
          className="mb-5 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <span className="inline-block h-1 w-1 rounded-full bg-[var(--cm-clay)]" />
          — cli sync
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease, delay: 0.08 }}
          className="text-[clamp(2rem,4vw,2.75rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Sync with{" "}
          <span className="italic text-[var(--cm-clay)]">claudemesh CLI</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease, delay: 0.16 }}
          className="mt-4 text-lg leading-[1.65] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Link your terminal session to your account and choose which meshes to
          sync.
        </motion.p>

        {/* Pairing code */}
        <AnimatePresence>
          {code && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.5, ease, delay: 0.24 }}
              className="mt-10 overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-clay)]/20"
            >
              {/* Terminal-style header bar */}
              <div className="flex items-center gap-2 border-b border-[var(--cm-clay)]/10 bg-[var(--cm-clay)]/[0.06] px-4 py-2.5">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--cm-fg-tertiary)]/30" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--cm-fg-tertiary)]/30" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--cm-fg-tertiary)]/30" />
                </div>
                <span
                  className="ml-2 text-[10px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  pairing verification
                </span>
              </div>
              {/* Code display */}
              <div className="bg-[var(--cm-bg-elevated)] px-5 py-6">
                <div className="flex items-center gap-4">
                  <span
                    className="text-xs text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    code:
                  </span>
                  <motion.span
                    className="text-4xl font-bold tracking-[0.2em] text-[var(--cm-clay)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8, delay: 0.5 }}
                  >
                    {code.split("").map((char, i) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.5 + i * 0.1, ease }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </motion.span>
                </div>
                <p
                  className="mt-3 text-[13px] leading-relaxed text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  Confirm this matches the code shown in your terminal.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading skeleton */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-10 space-y-3"
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-6 flex items-start gap-3 rounded-[var(--cm-radius-md)] border border-red-500/20 bg-red-500/[0.06] p-4"
            >
              <span className="mt-0.5 text-red-400">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </span>
              <span className="text-sm text-red-400">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Token result */}
        <AnimatePresence>
          {token && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="mt-10"
            >
              <div className="overflow-hidden rounded-[var(--cm-radius-md)] border border-emerald-500/20">
                {/* Success header */}
                <div className="flex items-center gap-2 border-b border-emerald-500/10 bg-emerald-500/[0.06] px-4 py-3">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-emerald-400"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span
                    className="text-sm font-medium text-emerald-400"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {redirected ? "Redirecting to CLI..." : "Sync token generated"}
                  </span>
                </div>
                {/* Token body */}
                <div className="bg-[var(--cm-bg-elevated)] p-5">
                  <p
                    className="mb-3 text-[13px] text-[var(--cm-fg-secondary)]"
                    style={{ fontFamily: "var(--cm-font-serif)" }}
                  >
                    {redirected
                      ? "If your terminal didn\u2019t pick up the token, copy it manually:"
                      : "Paste this token in your terminal when prompted:"}
                  </p>
                  <div className="flex items-stretch gap-2">
                    <div
                      className="min-w-0 flex-1 cursor-text overflow-hidden text-ellipsis whitespace-nowrap rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-3 py-2.5 text-xs text-[var(--cm-fg-tertiary)]"
                      style={{ fontFamily: "var(--cm-font-mono)" }}
                      onClick={(e) => {
                        const range = document.createRange();
                        range.selectNodeContents(e.currentTarget);
                        const sel = window.getSelection();
                        sel?.removeAllRanges();
                        sel?.addRange(range);
                      }}
                    >
                      {token}
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={handleCopy}
                      className="shrink-0 rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-4 py-2.5 text-sm font-medium text-[var(--cm-fg-secondary)] transition-all duration-200 hover:border-[var(--cm-clay)]/40 hover:text-[var(--cm-fg)]"
                    >
                      {copied ? (
                        <span className="text-emerald-400">Copied</span>
                      ) : (
                        "Copy"
                      )}
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mesh list */}
        {!loading && !token && meshes.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-10"
          >
            <h2
              className="mb-4 text-lg font-medium text-[var(--cm-fg)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              Your meshes
            </h2>
            <div className="space-y-2">
              {meshes.map((m, i) => (
                <motion.label
                  key={m.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease, delay: 0.35 + i * 0.06 }}
                  className={`group flex cursor-pointer items-center gap-4 rounded-[var(--cm-radius-md)] border p-4 transition-all duration-200 ${
                    selected.has(m.id)
                      ? "border-[var(--cm-clay)]/30 bg-[var(--cm-clay)]/[0.04]"
                      : "border-[var(--cm-border)] hover:border-[var(--cm-clay)]/20 hover:bg-[var(--cm-bg-elevated)]"
                  }`}
                >
                  {/* Custom checkbox */}
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all duration-200 ${
                      selected.has(m.id)
                        ? "border-[var(--cm-clay)] bg-[var(--cm-clay)]"
                        : "border-[var(--cm-fg-tertiary)]/40 group-hover:border-[var(--cm-fg-tertiary)]"
                    }`}
                  >
                    {selected.has(m.id) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggleMesh(m.id)}
                      className="sr-only"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-[var(--cm-fg)]">
                        {m.name}
                      </span>
                      <span
                        className="text-[11px] text-[var(--cm-fg-tertiary)]"
                        style={{ fontFamily: "var(--cm-font-mono)" }}
                      >
                        {m.slug}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--cm-fg-tertiary)]">
                      {m.memberCount}{" "}
                      {m.memberCount === 1 ? "member" : "members"}
                    </span>
                  </div>

                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors duration-200 ${
                      selected.has(m.id)
                        ? "border-[var(--cm-clay)]/30 text-[var(--cm-clay)]"
                        : "border-[var(--cm-border)] text-[var(--cm-fg-tertiary)]"
                    }`}
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    {m.isOwner ? "owner" : m.myRole}
                  </span>
                </motion.label>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.5 }}
              className="mt-8 flex items-center gap-4"
            >
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSync}
                disabled={syncing || selected.size === 0}
                className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-7 py-3.5 text-[15px] font-medium text-white transition-all duration-300 hover:bg-[var(--cm-clay-hover)] disabled:opacity-40"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                {syncing ? (
                  <>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="inline-block"
                    >
                      ⟳
                    </motion.span>
                    Generating...
                  </>
                ) : (
                  <>
                    Sync to CLI
                    <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                      →
                    </span>
                  </>
                )}
              </motion.button>
              <span className="text-xs text-[var(--cm-fg-tertiary)]">
                {selected.size} of {meshes.length} selected
              </span>
            </motion.div>
          </motion.div>
        )}

        {/* No meshes — create form */}
        {!loading && !token && meshes.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease, delay: 0.3 }}
            className="mt-10"
          >
            <div className="overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-clay)]/20">
              {/* Header */}
              <div className="border-b border-[var(--cm-clay)]/10 bg-[var(--cm-clay)]/[0.06] px-5 py-4">
                <h2
                  className="text-lg font-medium text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  Create your first mesh
                </h2>
                <p
                  className="mt-1 text-[13px] leading-relaxed text-[var(--cm-fg-secondary)]"
                  style={{ fontFamily: "var(--cm-font-serif)" }}
                >
                  A mesh is the space where your Claude Code sessions talk to each
                  other.
                </p>
              </div>

              {/* Form */}
              <div className="space-y-5 bg-[var(--cm-bg-elevated)] p-5">
                <div>
                  <label
                    htmlFor="mesh-name"
                    className="mb-1.5 block text-sm font-medium text-[var(--cm-fg)]"
                  >
                    Name
                  </label>
                  <input
                    ref={nameInputRef}
                    id="mesh-name"
                    type="text"
                    placeholder="Platform team"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-3.5 py-2.5 text-sm text-[var(--cm-fg)] placeholder:text-[var(--cm-fg-tertiary)]/50 transition-colors duration-200 focus:border-[var(--cm-clay)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--cm-clay)]/20"
                  />
                </div>
                <div>
                  <label
                    htmlFor="mesh-slug"
                    className="mb-1.5 block text-sm font-medium text-[var(--cm-fg)]"
                  >
                    Slug
                  </label>
                  <input
                    id="mesh-slug"
                    type="text"
                    placeholder="platform-team"
                    value={newSlug}
                    onChange={(e) => {
                      setSlugDirty(true);
                      setNewSlug(e.target.value);
                    }}
                    className="w-full rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-3.5 py-2.5 text-sm text-[var(--cm-fg)] placeholder:text-[var(--cm-fg-tertiary)]/50 transition-colors duration-200 focus:border-[var(--cm-clay)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--cm-clay)]/20"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  />
                  <p
                    className="mt-1.5 text-xs text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    lowercase · digits · hyphens
                  </p>
                </div>

                <AnimatePresence>
                  {createError && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-sm text-red-400"
                    >
                      {createError}
                    </motion.p>
                  )}
                </AnimatePresence>

                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCreate}
                  disabled={creating || !newName.trim() || !newSlug.trim()}
                  className="group inline-flex w-full items-center justify-center gap-2.5 rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-6 py-3.5 text-[15px] font-medium text-white transition-all duration-300 hover:bg-[var(--cm-clay-hover)] disabled:opacity-40"
                  style={{ fontFamily: "var(--cm-font-sans)" }}
                >
                  {creating ? (
                    <>
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="inline-block"
                      >
                        ⟳
                      </motion.span>
                      Creating...
                    </>
                  ) : (
                    <>
                      Create &amp; sync to CLI
                      <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                        →
                      </span>
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Footer security note */}
        <AnimatePresence>
          {!token && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="mt-16 flex items-start gap-3 text-[13px] leading-[1.7] text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0 text-[var(--cm-fg-tertiary)]/60"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>
                The sync token is valid for 15 minutes and can only be used once.
                Your ed25519 keys stay on your machine — the broker only sees
                ciphertext.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
