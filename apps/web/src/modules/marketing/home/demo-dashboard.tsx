"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Reveal, SectionIcon } from "./_reveal";
import {
  LOOP_PAUSE_MS,
  MESH_NAME,
  PEERS,
  SCRIPT,
  SCRIPT_DURATION_MS,
  type DemoMessage,
} from "./demo-dashboard-script";
import { MeshStream, type StreamMessage, type StreamPeer } from "./mesh-stream";

const toStreamMessage = (
  m: DemoMessage,
  loopKey: number,
): StreamMessage => ({
  key: `${loopKey}-${m.t}`,
  from: m.from,
  to: m.to,
  type: m.type,
  text: m.text,
  ciphertext: m.ciphertext,
});

const STREAM_PEERS: StreamPeer[] = PEERS.map((p) => ({
  id: p.id,
  name: p.name,
  status: p.status,
  machine: p.machine,
  surface: p.surface,
}));

export const DemoDashboard = () => {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loopCount, setLoopCount] = useState(0);
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

  const messages = useMemo<StreamMessage[]>(
    () =>
      SCRIPT.filter((m) => m.t <= elapsed).map((m) =>
        toStreamMessage(m, loopCount),
      ),
    [elapsed, loopCount],
  );

  const handleRestart = () => {
    setElapsed(0);
    startRef.current = performance.now();
    setLoopCount((c) => c + 1);
  };

  const footer = (
    <>
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
          {messages.length} / {SCRIPT.length} messages
        </span>
        <span>
          loop #{loopCount + 1} · {Math.floor(elapsed / 1000)}s /{" "}
          {Math.floor(SCRIPT_DURATION_MS / 1000)}s
        </span>
        <span>{playing ? "▶ playing" : "⏸ paused"}</span>
      </div>
    </>
  );

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
            Real conversation between peers. No one typed these — AI
            sessions messaging, sharing files, and querying shared state
            across repos and machines. Hover any message to see what the
            broker sees: ciphertext only.
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
            {/* unused var to silence lint on LOOP_PAUSE_MS if dead-code elimination hits */}
            <span hidden>{LOOP_PAUSE_MS}</span>
            <MeshStream
              peers={STREAM_PEERS}
              messages={messages}
              channelLabel="live-stream"
              footer={footer}
            />
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
      </div>
    </section>
  );
};
