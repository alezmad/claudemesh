import { isOptedOut } from "./opt-out.js";

export interface TelemetryEvent {
  event: string;
  properties?: Record<string, unknown>;
}

export function emit(event: TelemetryEvent): void {
  if (isOptedOut()) return;
  // Pass 1: telemetry is a no-op stub. Events are defined but not sent.
  // Pass 2 adds PostHog or similar backend.
}
