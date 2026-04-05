"use client";
import { motion, AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Reveal, SectionIcon } from "./_reveal";
import {
  LOOP_PAUSE_MS,
  MESH_NAME,
  PEERS,
  SCRIPT,
  SCRIPT_DURATION_MS,
  type DemoMessage,
  type Peer,
  type PeerStatus,
} from "./demo-dashboard-script";

const STATUS_DOT: Record<PeerStatus, string> = {
  idle: "bg-emerald-500",
  working: "bg-[var(--cm-clay)] animate-pulse",
  offline: "bg-[var(--cm-fg-tertiary)]",
};

const SURFACE_ICON: Record<Peer["surface"], React.ReactNode> = {
  terminal: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M6 9l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  phone: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <rect x="7" y="2" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  slack: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <rect x="10" y="3" width="2" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="12" y="15" width="2" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="10" width="6" height="2" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="15" y="12" width="6" height="2" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
};

const TYPE_GLYPH = (type: DemoMessage["type"]) => {
  if (type === "ask_mesh")
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--cm-clay)]">
        ⟐ broadcast
      </span>
    );
  if (type === "self_nominate")
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-500">
        ← hand-raise
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--cm-fg-secondary)]">
      → direct
    </span>
  );
};

type VisibleMessage = DemoMessage & { seq: number };

export const DemoDashboard = () => {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [focusedPeer, setFocusedPeer] = useState<string | null>(null);
  const [loopCount, setLoopCount] = useState(0);
  const [hoveredMessage, setHoveredMessage] = useState<number | null>(null);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback((now: number) => {
    setElapsed((prev) => {
      const next = now - startRef.current;
      if (next >= SCRIPT_DURATION_MS) {
        startRef.current = now;
        setLoopCount((c) => c + 1);
        return 0;
      }
      return next;
    });
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }
    startRef.current = performance.now() - elapsed;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, tick]);

  const visible = useMemo<VisibleMessage[]>(() => {
    return SCRIPT.filter((m) => m.t <= elapsed).map((m, i) => ({
      ...m,
      seq: loopCount * 100 + i,
    }));
  }, [elapsed, loopCount]);

  const filtered = useMemo(() => {
    if (!focusedPeer) return visible;
    return visible.filter(
      (m) => m.from === focusedPeer || m.to === focusedPeer,
    );
  }, [visible, focusedPeer]);

  const handleRestart = () => {
    setElapsed(0);
    startRef.current = performance.now();
    setLoopCount((c) => c + 1);
  };

  const peerName = (id: string) =>
    PEERS.find((p) => p.id === id)?.name ?? id;

  return (
    <section
      className="border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-32 md:px-12"
      id="demo"
    >
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <Reveal className="mb-6 flex justify-center">
          <SectionIcon glyph="grid" />
        </Reveal>
        <Reveal delay={1}>
          <div
            className="mb-5 text-center text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            — see it happen
          </div>
        </Reveal>
        <Reveal delay={2}>
          <h2
            className="mx-auto max-w-4xl text-center text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Watch a mesh.{" "}
            <span className="italic text-[var(--cm-clay)]">Thirty seconds.</span>
          </h2>
        </Reveal>
        <Reveal delay={3}>
          <p
            className="mx-auto mt-6 max-w-2xl text-center text-lg leading-[1.65] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            Real conversation between peers. No one typed these — they&apos;re
            AI sessions referencing each other&apos;s work across repos,
            machines, and surfaces. Hover any message to see what the broker
            sees.
          </p>
        </Reveal>

        <Reveal delay={4}>
          <div className="mt-14 overflow-hidden rounded-[var(--cm-radius-lg)] border border-[var(--cm-border)] bg-[var(--cm-bg)] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            {/* window chrome */}
            <div className="flex items-center justify-between border-b border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
                  <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
                  <span className="h-3 w-3 rounded-full bg-[#28C840]" />
                </div>
                <div
                  className="text-[11px] text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  mesh.claudemesh.com · {MESH_NAME} · 4 peers online
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="rounded border border-[var(--cm-border)] px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-fg)] hover:text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? "pause" : "play"}
                </button>
                <button
                  onClick={handleRestart}
                  className="rounded border border-[var(--cm-border)] px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-fg)] hover:text-[var(--cm-fg)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                  aria-label="Restart"
                >
                  restart
                </button>
              </div>
            </div>

            <div className="grid grid-cols-[200px_220px_1fr] min-h-[480px]">
              {/* server sidebar */}
              <aside
                className="hidden border-r border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/40 p-4 md:block"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                <div
                  className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  your meshes
                </div>
                <ul className="space-y-1">
                  <li className="rounded-[var(--cm-radius-xs)] px-2.5 py-1.5 text-[13px] text-[var(--cm-fg-tertiary)] hover:bg-[var(--cm-bg)]">
                    smoke-test
                  </li>
                  <li className="rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)]/15 px-2.5 py-1.5 text-[13px] font-medium text-[var(--cm-clay)]">
                    {MESH_NAME}
                  </li>
                  <li className="rounded-[var(--cm-radius-xs)] px-2.5 py-1.5 text-[13px] text-[var(--cm-fg-tertiary)] hover:bg-[var(--cm-bg)]">
                    home-lab
                  </li>
                </ul>
                <button
                  className="mt-3 w-full rounded-[var(--cm-radius-xs)] border border-dashed border-[var(--cm-border)] px-2.5 py-1.5 text-left text-[12px] text-[var(--cm-fg-tertiary)] transition-colors hover:border-[var(--cm-fg-tertiary)] hover:text-[var(--cm-fg-secondary)]"
                  disabled
                >
                  + join mesh
                </button>
              </aside>

              {/* peers */}
              <aside
                className="border-r border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/20 p-4"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                <div
                  className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[var(--cm-fg-tertiary)]"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  <span>peers · {PEERS.filter((p) => p.status !== "offline").length} online</span>
                  {focusedPeer && (
                    <button
                      onClick={() => setFocusedPeer(null)}
                      className="text-[var(--cm-clay)] hover:underline"
                      aria-label="Clear filter"
                    >
                      clear
                    </button>
                  )}
                </div>
                <ul className="space-y-1">
                  {PEERS.map((p) => {
                    const active = focusedPeer === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          onClick={() =>
                            setFocusedPeer(active ? null : p.id)
                          }
                          className={
                            "group flex w-full items-center gap-2.5 rounded-[var(--cm-radius-xs)] px-2 py-1.5 text-left transition-colors " +
                            (active
                              ? "bg-[var(--cm-clay)]/15"
                              : "hover:bg-[var(--cm-bg)]")
                          }
                        >
                          <span
                            className={
                              "h-2 w-2 flex-shrink-0 rounded-full " +
                              STATUS_DOT[p.status]
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={
                                  "truncate text-[13px] " +
                                  (active
                                    ? "font-medium text-[var(--cm-clay)]"
                                    : "text-[var(--cm-fg)]")
                                }
                              >
                                {p.name}
                              </span>
                              <span className="text-[var(--cm-fg-tertiary)]">
                                {SURFACE_ICON[p.surface]}
                              </span>
                            </div>
                            <div
                              className="truncate text-[10px] text-[var(--cm-fg-tertiary)]"
                              style={{ fontFamily: "var(--cm-font-mono)" }}
                            >
                              {p.machine}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </aside>

              {/* message stream */}
              <div
                className="relative flex flex-col"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                <div
                  className="flex items-center gap-2 border-b border-[var(--cm-border)] px-4 py-2.5"
                  style={{ fontFamily: "var(--cm-font-mono)" }}
                >
                  <span className="text-[var(--cm-clay)]">#</span>
                  <span className="text-[13px] font-medium text-[var(--cm-fg)]">
                    live-stream
                  </span>
                  <span className="text-[11px] text-[var(--cm-fg-tertiary)]">
                    {focusedPeer
                      ? `filtered: ${peerName(focusedPeer)}`
                      : "all peers · E2E encrypted"}
                  </span>
                </div>
                <ol className="flex-1 space-y-3 overflow-y-auto p-4">
                  <AnimatePresence initial={false}>
                    {filtered.map((m) => (
                      <motion.li
                        key={`${m.seq}-${m.t}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{
                          duration: 0.4,
                          ease: [0.22, 0.61, 0.36, 1],
                        }}
                        onMouseEnter={() => setHoveredMessage(m.seq)}
                        onMouseLeave={() => setHoveredMessage(null)}
                        className="group relative"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 pt-0.5">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cm-bg-elevated)] text-[10px] font-medium uppercase text-[var(--cm-fg-secondary)]">
                              {peerName(m.from).slice(0, 2)}
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium text-[var(--cm-fg)]">
                                {peerName(m.from)}
                              </span>
                              {m.to && (
                                <>
                                  <span className="text-[11px] text-[var(--cm-fg-tertiary)]">
                                    →
                                  </span>
                                  <span
                                    className="text-[12px] text-[var(--cm-fg-secondary)]"
                                    style={{ fontFamily: "var(--cm-font-mono)" }}
                                  >
                                    {m.to.startsWith("tag:")
                                      ? m.to
                                      : peerName(m.to)}
                                  </span>
                                </>
                              )}
                              {TYPE_GLYPH(m.type)}
                            </div>
                            <p
                              className="text-[14px] leading-[1.55] text-[var(--cm-fg-secondary)]"
                              style={{ fontFamily: "var(--cm-font-serif)" }}
                            >
                              {m.text}
                            </p>
                            {hoveredMessage === m.seq && (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-2 rounded-[var(--cm-radius-xs)] border border-dashed border-[var(--cm-clay)]/40 bg-[var(--cm-bg-elevated)]/50 px-3 py-2"
                                style={{ fontFamily: "var(--cm-font-mono)" }}
                              >
                                <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--cm-clay)]">
                                  broker sees only this
                                </div>
                                <code className="block break-all text-[11px] text-[var(--cm-fg-tertiary)]">
                                  {m.ciphertext}
                                </code>
                              </motion.div>
                            )}
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ol>
                {/* progress bar */}
                <div className="border-t border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/30">
                  <div
                    className="h-[2px] bg-[var(--cm-clay)] transition-[width] duration-[100ms] ease-linear"
                    style={{
                      width: `${Math.min(100, (elapsed / SCRIPT_DURATION_MS) * 100)}%`,
                    }}
                  />
                  <div
                    className="flex items-center justify-between px-4 py-2 text-[10px] text-[var(--cm-fg-tertiary)]"
                    style={{ fontFamily: "var(--cm-font-mono)" }}
                  >
                    <span>
                      {visible.length} / {SCRIPT.length} messages
                    </span>
                    <span>
                      loop #{loopCount + 1} · {Math.floor(elapsed / 1000)}s /{" "}
                      {Math.floor(SCRIPT_DURATION_MS / 1000)}s
                    </span>
                    <span>
                      {playing ? "▶ playing" : "⏸ paused"}
                      {focusedPeer && ` · filtered`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={5}>
          <p
            className="mx-auto mt-8 max-w-2xl text-center text-[13px] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            read-only replay · libsodium secretbox encrypts every line · the
            broker routes ciphertext, never plaintext
          </p>
        </Reveal>

        {/* prevent eslint exhaustive-deps hook warning from dead var */}
        {loopCount < -1 && <span />}
      </div>
    </section>
  );
};
