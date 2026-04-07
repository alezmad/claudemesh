/**
 * Slack client — Socket Mode connection + Web API helpers.
 *
 * Uses Socket Mode so users do not need a public URL for Events API.
 * Listens for messages in a single configured channel and provides
 * a method to post formatted messages back.
 */

import { WebClient } from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";

export interface SlackMessage {
  /** Slack user ID (e.g. U0123456789) */
  userId: string;
  /** Resolved display name (falls back to userId if lookup fails) */
  displayName: string;
  /** Message text */
  text: string;
  /** Slack channel ID */
  channelId: string;
  /** Message timestamp (Slack's unique ID for the message) */
  ts: string;
}

export type SlackMessageHandler = (msg: SlackMessage) => void;

export class SlackClient {
  private web: WebClient;
  private socket: SocketModeClient;
  private channelId: string;
  private userCache = new Map<string, string>();
  private handlers = new Set<SlackMessageHandler>();

  constructor(botToken: string, appToken: string, channelId: string) {
    this.web = new WebClient(botToken);
    this.socket = new SocketModeClient({ appToken });
    this.channelId = channelId;
  }

  /**
   * Connect to Slack via Socket Mode and start listening for messages.
   */
  async connect(): Promise<void> {
    // Verify the bot token works and cache the bot's own user ID
    // so we can ignore messages from ourselves.
    const authResult = await this.web.auth.test();
    const botUserId = authResult.user_id as string;

    this.socket.on("message", async ({ event, ack }) => {
      // Always acknowledge the event to Slack
      await ack();

      // Only process messages from the configured channel
      if (event.channel !== this.channelId) return;

      // Ignore bot's own messages, message_changed edits, and subtypes
      // like channel_join, channel_leave, etc.
      if (event.user === botUserId) return;
      if (event.subtype) return;
      if (!event.text) return;

      const displayName = await this.resolveUserName(event.user);
      const msg: SlackMessage = {
        userId: event.user,
        displayName,
        text: event.text,
        channelId: event.channel,
        ts: event.ts,
      };

      for (const handler of this.handlers) {
        try {
          handler(msg);
        } catch {
          // Handler errors should not break the event loop
        }
      }
    });

    await this.socket.start();
  }

  /**
   * Post a message to the configured Slack channel.
   */
  async postMessage(text: string): Promise<void> {
    await this.web.chat.postMessage({
      channel: this.channelId,
      text,
      // Use mrkdwn so mesh peer names can be bolded
      mrkdwn: true,
    });
  }

  /**
   * Register a handler for incoming Slack messages.
   * Returns an unsubscribe function.
   */
  onMessage(handler: SlackMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Resolve a Slack user ID to a display name.
   * Results are cached for the lifetime of the process.
   */
  async resolveUserName(userId: string): Promise<string> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    try {
      const result = await this.web.users.info({ user: userId });
      const name =
        result.user?.profile?.display_name ||
        result.user?.real_name ||
        result.user?.name ||
        userId;
      this.userCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  /**
   * Disconnect from Socket Mode.
   */
  async disconnect(): Promise<void> {
    await this.socket.disconnect();
  }
}
