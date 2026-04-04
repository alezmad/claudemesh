/**
 * Metrics output + counter/gauge behavior tests.
 *
 * Pure in-process — no DB, no network. Asserts Prometheus text
 * format and counter/gauge increment semantics.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { metrics, metricsToText } from "../src/metrics";

describe("metrics registry", () => {
  test("every expected series is present in /metrics text", () => {
    const text = metricsToText();
    const expected = [
      "broker_connections_total",
      "broker_connections_rejected_total",
      "broker_connections_active",
      "broker_messages_routed_total",
      "broker_messages_rejected_total",
      "broker_queue_depth",
      "broker_ttl_sweeps_total",
      "broker_hook_requests_total",
      "broker_hook_requests_rate_limited_total",
      "broker_db_healthy",
    ];
    for (const name of expected) {
      expect(text).toContain(`# HELP ${name}`);
      expect(text).toContain(`# TYPE ${name}`);
    }
  });

  test("counter increments and appears in output", () => {
    const before = metrics.connectionsTotal.toText();
    const beforeVal = parseInt(
      before.split("\n").find((l) => l.startsWith("broker_connections_total "))
        ?.split(" ")[1] ?? "0",
      10,
    );
    metrics.connectionsTotal.inc();
    metrics.connectionsTotal.inc();
    const after = metrics.connectionsTotal.toText();
    const afterVal = parseInt(
      after.split("\n").find((l) => l.startsWith("broker_connections_total "))
        ?.split(" ")[1] ?? "0",
      10,
    );
    expect(afterVal - beforeVal).toBeGreaterThanOrEqual(2);
  });

  test("counter labels produce separate series lines", () => {
    metrics.messagesRoutedTotal.inc({ priority: "now" });
    metrics.messagesRoutedTotal.inc({ priority: "now" });
    metrics.messagesRoutedTotal.inc({ priority: "next" });
    const text = metrics.messagesRoutedTotal.toText();
    expect(text).toMatch(/broker_messages_routed_total\{priority="now"\}/);
    expect(text).toMatch(/broker_messages_routed_total\{priority="next"\}/);
  });

  test("gauge set overwrites prior value", () => {
    metrics.connectionsActive.set(5);
    let text = metrics.connectionsActive.toText();
    expect(text).toMatch(/broker_connections_active 5/);
    metrics.connectionsActive.set(2);
    text = metrics.connectionsActive.toText();
    expect(text).toMatch(/broker_connections_active 2/);
    expect(text).not.toMatch(/broker_connections_active 5/);
  });

  test("prometheus format is well-formed (HELP + TYPE before samples)", () => {
    const text = metrics.queueDepth.toText();
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^# HELP broker_queue_depth /);
    expect(lines[1]).toMatch(/^# TYPE broker_queue_depth gauge$/);
    // Every non-comment line should be well-formed.
    for (const line of lines.slice(2)) {
      if (line.trim() === "") continue;
      expect(line).toMatch(/^broker_queue_depth(\{[^}]*\})? -?\d+(\.\d+)?$/);
    }
  });
});
