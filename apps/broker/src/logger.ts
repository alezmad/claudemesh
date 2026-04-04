/**
 * Structured JSON logger.
 *
 * One line per log event. Production observability tools (Datadog,
 * Loki, etc.) can ingest these directly. Dev readability is
 * secondary — if you're eyeballing, pipe through `jq`.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, ctx: LogContext = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: "broker",
    msg,
    ...ctx,
  };
  // Single line, no pretty-printing. stderr so stdout is free for
  // any app-level protocol chatter.
  console.error(JSON.stringify(entry));
}

export const log = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
};
