/**
 * Bridge — bidirectional message relay between Slack and a claudemesh mesh.
 *
 * Slack -> Mesh: messages from the Slack channel are broadcast to mesh peers.
 * Mesh -> Slack: push messages addressed to this connector (or broadcast)
 *                are posted to the Slack channel.
 */

import type { SlackClient } from "./slack";
import type { MeshClient } from "./mesh-client";
import type { SlackConnectorConfig } from "./config";

export class Bridge {
  private slack: SlackClient;
  private mesh: MeshClient;
  private config: SlackConnectorConfig;
  private unsubSlack: (() => void) | null = null;
  private unsubMesh: (() => void) | null = null;
  /** Track message IDs we've relayed to avoid echo loops. */
  private recentRelayed = new Set<string>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    slack: SlackClient,
    mesh: MeshClient,
    config: SlackConnectorConfig,
  ) {
    this.slack = slack;
    this.mesh = mesh;
    this.config = config;
  }

  /**
   * Start the bidirectional relay.
   */
  start(): void {
    // --- Slack -> Mesh ---
    this.unsubSlack = this.slack.onMessage((msg) => {
      const channelName = this.config.slackChannelId;
      const formatted = `[${msg.displayName} via Slack #${channelName}] ${msg.text}`;

      // Broadcast to all mesh peers
      this.mesh.broadcast(formatted).catch((err) => {
        console.error("[bridge] Failed to relay Slack->Mesh:", err);
      });
    });

    // --- Mesh -> Slack ---
    this.unsubMesh = this.mesh.onPush((push) => {
      // Skip messages we ourselves sent (echo prevention)
      if (this.recentRelayed.has(push.messageId)) {
        this.recentRelayed.delete(push.messageId);
        return;
      }

      // Skip system events (peer_joined, peer_left) — too noisy for Slack
      if (push.subtype === "system") return;

      const plaintext = push.plaintext;
      if (!plaintext) return;

      // Resolve sender name from the push metadata
      const senderName = push.senderName || push.senderPubkey.slice(0, 8);
      const formatted = `*[${senderName}]*: ${plaintext}`;

      this.slack.postMessage(formatted).catch((err) => {
        console.error("[bridge] Failed to relay Mesh->Slack:", err);
      });
    });

    // Periodically clean the echo-prevention set to prevent memory leaks
    this.cleanupTimer = setInterval(() => {
      this.recentRelayed.clear();
    }, 60_000);

    console.log("[bridge] Relay started");
  }

  /**
   * Stop the relay and clean up subscriptions.
   */
  stop(): void {
    if (this.unsubSlack) {
      this.unsubSlack();
      this.unsubSlack = null;
    }
    if (this.unsubMesh) {
      this.unsubMesh();
      this.unsubMesh = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    console.log("[bridge] Relay stopped");
  }
}
