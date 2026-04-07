/**
 * Configuration types for the Slack connector.
 *
 * All values are loaded from environment variables in index.ts.
 */

export interface SlackConnectorConfig {
  // Slack
  /** Bot User OAuth Token (xoxb-...) */
  slackBotToken: string;
  /** App-Level Token for Socket Mode (xapp-...) */
  slackAppToken: string;
  /** Channel ID to bridge (e.g. C0123456789) */
  slackChannelId: string;

  // Mesh
  /** WebSocket URL of the claudemesh broker (wss://...) */
  brokerUrl: string;
  /** Mesh UUID */
  meshId: string;
  /** Member UUID (this connector's membership) */
  memberId: string;
  /** Ed25519 public key, hex-encoded (64 chars) */
  pubkey: string;
  /** Ed25519 secret key, hex-encoded (128 chars) */
  secretKey: string;
  /** Display name visible to mesh peers (e.g. "Slack-#general") */
  displayName: string;
}

/**
 * Load config from environment variables, throwing on any missing required var.
 */
export function loadConfigFromEnv(): SlackConnectorConfig {
  const required: Array<[keyof SlackConnectorConfig, string]> = [
    ["slackBotToken", "SLACK_BOT_TOKEN"],
    ["slackAppToken", "SLACK_APP_TOKEN"],
    ["slackChannelId", "SLACK_CHANNEL_ID"],
    ["brokerUrl", "MESH_BROKER_URL"],
    ["meshId", "MESH_ID"],
    ["memberId", "MESH_MEMBER_ID"],
    ["pubkey", "MESH_PUBKEY"],
    ["secretKey", "MESH_SECRET_KEY"],
  ];

  const missing: string[] = [];
  const values: Record<string, string> = {};

  for (const [key, envVar] of required) {
    const val = process.env[envVar];
    if (!val) {
      missing.push(envVar);
    } else {
      values[key] = val;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    ...(values as unknown as Omit<SlackConnectorConfig, "displayName">),
    displayName:
      process.env.MESH_DISPLAY_NAME ??
      process.env.DISPLAY_NAME ??
      "Slack-connector",
  };
}
