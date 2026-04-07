/**
 * @claudemesh/connector-slack — entry point.
 *
 * Bridges a Slack channel to a claudemesh mesh, relaying messages
 * bidirectionally. The connector joins the mesh as a peer with
 * peerType: "connector" and channel: "slack".
 *
 * Usage:
 *   SLACK_BOT_TOKEN=xoxb-... \
 *   SLACK_APP_TOKEN=xapp-... \
 *   SLACK_CHANNEL_ID=C0123456789 \
 *   MESH_BROKER_URL=wss://ic.claudemesh.com/ws \
 *   MESH_ID=... \
 *   MESH_MEMBER_ID=... \
 *   MESH_PUBKEY=... \
 *   MESH_SECRET_KEY=... \
 *   MESH_DISPLAY_NAME="Slack-#general" \
 *   node dist/index.js
 */

import { loadConfigFromEnv } from "./config";
import { SlackClient } from "./slack";
import { MeshClient } from "./mesh-client";
import { Bridge } from "./bridge";

async function main(): Promise<void> {
  console.log("[connector-slack] Loading configuration...");
  const config = loadConfigFromEnv();

  // --- Connect to mesh ---
  console.log(
    `[connector-slack] Connecting to mesh ${config.meshId} at ${config.brokerUrl}...`,
  );
  const mesh = new MeshClient(config);
  await mesh.connect();
  console.log(
    `[connector-slack] Mesh connected as "${config.displayName}" (peerType: connector, channel: slack)`,
  );
  mesh.setSummary(
    `Slack connector bridging channel ${config.slackChannelId} to this mesh`,
  );

  // --- Connect to Slack ---
  console.log("[connector-slack] Connecting to Slack via Socket Mode...");
  const slack = new SlackClient(
    config.slackBotToken,
    config.slackAppToken,
    config.slackChannelId,
  );
  await slack.connect();
  console.log(
    `[connector-slack] Slack connected, listening on channel ${config.slackChannelId}`,
  );

  // --- Start bridge ---
  const bridge = new Bridge(slack, mesh, config);
  bridge.start();
  console.log("[connector-slack] Bridge active. Relaying messages...");

  // --- Graceful shutdown ---
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[connector-slack] Received ${signal}, shutting down...`);
    bridge.stop();
    await slack.disconnect();
    mesh.close();
    console.log("[connector-slack] Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[connector-slack] Fatal:", err);
  process.exit(1);
});
