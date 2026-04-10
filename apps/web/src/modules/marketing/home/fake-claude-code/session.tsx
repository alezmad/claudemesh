"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// useRef is still used for onEventRef below
import { fccTheme } from "./theme";
import { TerminalWindow } from "./terminal-window";
import { Welcome } from "./welcome";
import {
  AssistantTextRow,
  BulletRow,
  MeshMessageRow,
  ToolUseRow,
  UserPromptRow,
} from "./message-row";
import { PromptInput } from "./prompt-input";
import { StatusBar } from "./status-bar";
import { ThinkingSpinner } from "./thinking-spinner";

export type SessionStep =
  | { type: "user-input"; text: string; typeMs?: number }
  | { type: "thinking"; durationMs: number; label?: string }
  | { type: "assistant-text"; text: string; streamMs?: number }
  | { type: "tool-use"; name: string; args?: string; result?: string }
  | { type: "bullet"; text: string; color?: "success" | "error" | "dim" }
  | {
      type: "mesh-send";
      to: string;
      message: string;
    }
  | {
      type: "mesh-receive";
      from: string;
      message: string;
    }
  | { type: "pause"; durationMs: number };

export type SessionEvent =
  | { kind: "mesh-send"; sessionId: string; to: string; message: string; stepIndex: number }
  | { kind: "mesh-receive"; sessionId: string; from: string; message: string; stepIndex: number }
  | { kind: "step-start"; sessionId: string; stepIndex: number }
  | { kind: "script-complete"; sessionId: string };

export type SessionReaction = "receive" | "send" | "arrive";

export type SessionProps = {
  sessionId: string;
  script: SessionStep[];
  title?: string;
  cwd?: string;
  width?: number;
  height?: number;
  contextPct?: number;
  loop?: boolean;
  startDelayMs?: number;
  onEvent?: (event: SessionEvent) => void;
  /**
   * Bumps to trigger a reaction animation. Parent increments this to fire the
   * matching effect — e.g. an "arrive" pulse when a mesh particle lands.
   */
  reactionNonce?: number;
  reactionKind?: SessionReaction;
};

type RenderedStep =
  | { kind: "user-input"; text: string; done: boolean }
  | { kind: "thinking"; label: string }
  | { kind: "assistant-text"; text: string; done: boolean }
  | { kind: "tool-use"; name: string; args?: string; result?: string }
  | { kind: "bullet"; text: string; color: "success" | "error" | "dim" }
  | { kind: "mesh-send"; to: string; message: string }
  | { kind: "mesh-receive"; from: string; message: string };

export function Session({
  sessionId,
  script,
  title,
  cwd = "/Users/agutierrez",
  width = 760,
  height = 540,
  contextPct = 6,
  loop = true,
  startDelayMs = 0,
  onEvent,
  reactionNonce = 0,
  reactionKind = "receive",
}: SessionProps) {
  const [rendered, setRendered] = useState<RenderedStep[]>([]);
  const [liveInput, setLiveInput] = useState("");
  const [cycle, setCycle] = useState(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const scriptKey = useMemo(
    () => script.map((s) => s.type).join("|") + "::" + sessionId,
    [script, sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    setRendered([]);
    setLiveInput("");

    const wait = (ms: number) =>
      new Promise<void>((res) => {
        const id = setTimeout(() => {
          if (!cancelled) res();
        }, ms);
        void id;
      });

    const emit = (e: SessionEvent) => {
      if (!cancelled) onEventRef.current?.(e);
    };

    const appendStep = (step: RenderedStep) => {
      if (cancelled) return;
      setRendered((prev) => [...prev, step]);
    };

    const updateLast = (mut: (s: RenderedStep) => RenderedStep) => {
      if (cancelled) return;
      setRendered((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.slice();
        next[next.length - 1] = mut(next[next.length - 1]);
        return next;
      });
    };

    const popLast = () => {
      if (cancelled) return;
      setRendered((prev) => prev.slice(0, -1));
    };

    const run = async () => {
      if (startDelayMs > 0) await wait(startDelayMs);
      for (let i = 0; i < script.length; i++) {
        if (cancelled) return;
        const step = script[i];
        emit({ kind: "step-start", sessionId, stepIndex: i });

        switch (step.type) {
          case "pause":
            await wait(step.durationMs);
            break;

          case "user-input": {
            const ms = step.typeMs ?? 35;
            for (let c = 1; c <= step.text.length; c++) {
              if (cancelled) return;
              const slice = step.text.slice(0, c);
              if (!cancelled) setLiveInput(slice);
              await wait(ms);
            }
            // Submit: clear the input box and push the prompt into scrollback
            await wait(260);
            if (cancelled) return;
            setLiveInput("");
            appendStep({ kind: "user-input", text: step.text, done: true });
            await wait(140);
            break;
          }

          case "thinking": {
            appendStep({ kind: "thinking", label: step.label ?? "Thinking" });
            await wait(step.durationMs);
            popLast();
            break;
          }

          case "assistant-text": {
            appendStep({ kind: "assistant-text", text: "", done: false });
            const ms = step.streamMs ?? 18;
            for (let c = 1; c <= step.text.length; c++) {
              if (cancelled) return;
              const slice = step.text.slice(0, c);
              updateLast((s) =>
                s.kind === "assistant-text" ? { ...s, text: slice } : s,
              );
              await wait(ms);
            }
            updateLast((s) =>
              s.kind === "assistant-text" ? { ...s, done: true } : s,
            );
            await wait(250);
            break;
          }

          case "tool-use": {
            appendStep({
              kind: "tool-use",
              name: step.name,
              args: step.args,
              result: step.result,
            });
            await wait(400);
            break;
          }

          case "bullet": {
            appendStep({
              kind: "bullet",
              text: step.text,
              color: step.color ?? "success",
            });
            await wait(200);
            break;
          }

          case "mesh-send": {
            appendStep({
              kind: "mesh-send",
              to: step.to,
              message: step.message,
            });
            emit({
              kind: "mesh-send",
              sessionId,
              to: step.to,
              message: step.message,
              stepIndex: i,
            });
            await wait(350);
            break;
          }

          case "mesh-receive": {
            appendStep({
              kind: "mesh-receive",
              from: step.from,
              message: step.message,
            });
            emit({
              kind: "mesh-receive",
              sessionId,
              from: step.from,
              message: step.message,
              stepIndex: i,
            });
            await wait(350);
            break;
          }
        }
      }

      if (cancelled) return;
      emit({ kind: "script-complete", sessionId });

      if (loop) {
        await wait(2000);
        if (cancelled) return;
        setCycle((c) => c + 1);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [scriptKey, cycle, loop, script, sessionId, startDelayMs]);

  const reactionClass = `fcc-react-${reactionKind}`;
  const reactionKey = `${reactionKind}-${reactionNonce}`;

  return (
    <div
      key={reactionKey}
      className={reactionNonce > 0 ? reactionClass : undefined}
      style={{ willChange: "transform, filter" }}
    >
      <style>{`
        @keyframes fccPulseReceive {
          0%   { transform: scale(1); filter: drop-shadow(0 0 0 rgba(215,119,87,0)); }
          30%  { transform: scale(1.02); filter: drop-shadow(0 0 22px rgba(215,119,87,0.55)); }
          100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(215,119,87,0)); }
        }
        @keyframes fccPulseArrive {
          0%   { transform: scale(1); filter: brightness(1) drop-shadow(0 0 0 rgba(215,119,87,0)); }
          25%  { transform: scale(1.015); filter: brightness(1.25) drop-shadow(0 0 30px rgba(215,119,87,0.7)); }
          100% { transform: scale(1); filter: brightness(1) drop-shadow(0 0 0 rgba(215,119,87,0)); }
        }
        @keyframes fccPulseSend {
          0%   { transform: scale(1); }
          35%  { transform: scale(0.99); filter: drop-shadow(0 0 12px rgba(215,119,87,0.35)); }
          100% { transform: scale(1); }
        }
        .fcc-react-receive { animation: fccPulseReceive 380ms cubic-bezier(0.22, 0.61, 0.36, 1); }
        .fcc-react-arrive  { animation: fccPulseArrive 520ms cubic-bezier(0.22, 0.61, 0.36, 1); }
        .fcc-react-send    { animation: fccPulseSend 260ms cubic-bezier(0.22, 0.61, 0.36, 1); }
      `}</style>
    <TerminalWindow width={width} height={height} title={title}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: fccTheme.dim }}>[(base) </span>
        <span style={{ color: fccTheme.text }}>agutierrez@Mac</span>
        <span style={{ color: fccTheme.dim }}> ~ % </span>
        <span style={{ color: fccTheme.text }}>claude</span>
      </div>
      <Welcome cwd={cwd} />
      <div
        aria-hidden
        style={{
          marginTop: 8,
          marginBottom: 4,
          height: 1,
          background: `repeating-linear-gradient(90deg, ${fccTheme.subtle} 0 6px, transparent 6px 10px)`,
        }}
      />

      <div
        style={{
          minHeight: 180,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {rendered.map((s, i) => {
          switch (s.kind) {
            case "user-input":
              return (
                <UserPromptRow key={i}>
                  {s.text}
                  {!s.done && <BlinkCursor />}
                </UserPromptRow>
              );
            case "thinking":
              return (
                <div key={i} style={{ marginTop: 8 }}>
                  <ThinkingSpinner label={s.label} />
                </div>
              );
            case "assistant-text":
              return (
                <AssistantTextRow key={i}>
                  {s.text}
                  {!s.done && <BlinkCursor />}
                </AssistantTextRow>
              );
            case "tool-use":
              return (
                <ToolUseRow
                  key={i}
                  name={s.name}
                  args={s.args}
                  result={s.result}
                />
              );
            case "bullet":
              return (
                <BulletRow key={i} color={s.color}>
                  {s.text}
                </BulletRow>
              );
            case "mesh-send":
              return (
                <MeshMessageRow
                  key={i}
                  direction="out"
                  peer={s.to}
                  message={s.message}
                />
              );
            case "mesh-receive":
              return (
                <MeshMessageRow
                  key={i}
                  direction="in"
                  peer={s.from}
                  message={s.message}
                />
              );
          }
        })}
      </div>

      <PromptInput value={liveInput} />
      <StatusBar cwd="~" contextPct={contextPct} />
    </TerminalWindow>
    </div>
  );
}

function BlinkCursor() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.55ch",
        height: "1em",
        marginLeft: "0.15ch",
        verticalAlign: "text-bottom",
        backgroundColor: fccTheme.text,
        animation: "fccCaret 1s steps(1) infinite",
      }}
    />
  );
}
