/**
 * Minimal in-process metrics, exposed as Prometheus plaintext.
 *
 * Intentionally no external deps — we track a handful of counters
 * and gauges that matter for broker ops. Scraped by /metrics.
 */

type Labels = Record<string, string | number>;

class Counter {
  private values = new Map<string, number>();
  constructor(
    public name: string,
    public help: string,
  ) {}
  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }
  toText(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, v] of this.values) {
        lines.push(`${this.name}${key} ${v}`);
      }
    }
    return lines.join("\n");
  }
}

class Gauge {
  private values = new Map<string, number>();
  constructor(
    public name: string,
    public help: string,
  ) {}
  set(value: number, labels: Labels = {}): void {
    this.values.set(labelKey(labels), value);
  }
  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }
  dec(labels: Labels = {}, by = 1): void {
    this.inc(labels, -by);
  }
  toText(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, v] of this.values) {
        lines.push(`${this.name}${key} ${v}`);
      }
    }
    return lines.join("\n");
  }
}

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const parts = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
    .join(",");
  return `{${parts}}`;
}

export const metrics = {
  connectionsTotal: new Counter(
    "broker_connections_total",
    "Total WS connection attempts",
  ),
  connectionsRejected: new Counter(
    "broker_connections_rejected_total",
    "WS connections refused (auth failure, capacity, etc.)",
  ),
  connectionsActive: new Gauge(
    "broker_connections_active",
    "Currently connected peers",
  ),
  messagesRoutedTotal: new Counter(
    "broker_messages_routed_total",
    "Messages successfully queued + routed",
  ),
  messagesRejectedTotal: new Counter(
    "broker_messages_rejected_total",
    "Messages rejected (size, auth, malformed)",
  ),
  messagesDroppedByGrantTotal: new Counter(
    "broker_messages_dropped_by_grant_total",
    "Messages silently dropped because recipient didn't grant sender the required capability",
  ),
  brokerLegacyAuthHitsTotal: new Counter(
    "broker_legacy_auth_hits_total",
    "Pre-alpha.36 clients authenticating via body.user_id fallback (remove shim when near zero)",
  ),
  queueDepth: new Gauge(
    "broker_queue_depth",
    "Undelivered messages currently in the queue",
  ),
  ttlSweepsTotal: new Counter(
    "broker_ttl_sweeps_total",
    "TTL sweeper runs completed",
  ),
  hookRequestsTotal: new Counter(
    "broker_hook_requests_total",
    "POST /hook/set-status requests received",
  ),
  hookRequestsRateLimited: new Counter(
    "broker_hook_requests_rate_limited_total",
    "POST /hook/set-status rejected by rate limit",
  ),
  dbHealthy: new Gauge(
    "broker_db_healthy",
    "1 if Postgres connection is up, 0 if not",
  ),
};

export function metricsToText(): string {
  return (
    Object.values(metrics)
      .map((m) => m.toText())
      .join("\n") + "\n"
  );
}
