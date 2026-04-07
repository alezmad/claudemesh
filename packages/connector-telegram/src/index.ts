/**
 * @claudemesh/connector-telegram — Entry point
 *
 * Bridges a Telegram chat and a claudemesh mesh, relaying messages
 * bidirectionally. Joins the mesh as peerType: "connector", channel: "telegram".
 *
 * Configuration via environment variables:
 *   TELEGRAM_BOT_TOKEN  — Bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — Target chat ID (group or user)
 *   BROKER_URL           — claudemesh broker WebSocket URL
 *   MESH_ID              — Mesh UUID
 *   MEMBER_ID            — Member UUID
 *   PUBKEY               — Ed25519 public key (hex)
 *   SECRET_KEY           — Ed25519 secret key (hex)
 *   DISPLAY_NAME         — Peer display name (default: "Telegram")
 */

import { loadConfigFromEnv } from "./config.js";
import { TelegramClient } from "./telegram.js";
import { MeshClient } from "./mesh-client.js";
import { Bridge } from "./bridge.js";

async function main(): Promise<void> {
  console.log("[connector-telegram] starting...");

  // Load configuration
  const config = loadConfigFromEnv();
  console.log(`[connector-telegram] display name: ${config.displayName}`);
  console.log(`[connector-telegram] chat ID: ${config.telegramChatId}`);
  console.log(`[connector-telegram] broker: ${config.brokerUrl}`);

  // Initialize clients
  const telegram = new TelegramClient(config.telegramBotToken, config.telegramChatId);
  const mesh = new MeshClient(config);

  // Connect to mesh broker
  console.log("[connector-telegram] connecting to mesh...");
  await mesh.connect();
  console.log("[connector-telegram] mesh connected");

  // Start Telegram long polling
  telegram.start();
  console.log("[connector-telegram] Telegram polling started");

  // Wire up bidirectional relay
  const bridge = new Bridge(telegram, mesh);
  bridge.start();

  console.log("[connector-telegram] bridge active — relaying messages");

  // Graceful shutdown
  const shutdown = (): void => {
    console.log("\n[connector-telegram] shutting down...");
    telegram.stop();
    mesh.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[connector-telegram] fatal:", err);
  process.exit(1);
});
