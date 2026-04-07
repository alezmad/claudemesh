/**
 * Minimal Telegram Bot API client using fetch + long polling.
 * Zero external dependencies.
 */

const POLL_TIMEOUT_SECS = 30;

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: { id: number; type: string; title?: string };
  date: number;
  text?: string;
}

interface Update {
  update_id: number;
  message?: TelegramMessage;
}

interface GetUpdatesResponse {
  ok: boolean;
  result: Update[];
  description?: string;
}

interface SendMessageResponse {
  ok: boolean;
  description?: string;
}

export type MessageHandler = (msg: TelegramMessage) => void;

export class TelegramClient {
  private baseUrl: string;
  private offset = 0;
  private running = false;
  private abortController: AbortController | null = null;
  private handlers = new Set<MessageHandler>();

  constructor(
    private botToken: string,
    private chatId: string,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.add(handler);
  }

  /** Send a text message to the configured chat. */
  async sendMessage(text: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: "HTML",
        }),
      });
      const data = (await res.json()) as SendMessageResponse;
      if (!data.ok) {
        console.error(`[telegram] sendMessage failed: ${data.description}`);
      }
      return data.ok;
    } catch (err) {
      console.error(`[telegram] sendMessage error:`, err);
      return false;
    }
  }

  /** Start long-polling loop. Non-blocking — runs in background. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollLoop();
  }

  /** Stop the polling loop gracefully. */
  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        this.abortController = new AbortController();
        const url = new URL(`${this.baseUrl}/getUpdates`);
        url.searchParams.set("offset", String(this.offset));
        url.searchParams.set("timeout", String(POLL_TIMEOUT_SECS));
        url.searchParams.set("allowed_updates", JSON.stringify(["message"]));

        const res = await fetch(url.toString(), {
          signal: this.abortController.signal,
          // Allow enough time for the long-poll plus network overhead
        });

        const data = (await res.json()) as GetUpdatesResponse;

        if (!data.ok) {
          console.error(`[telegram] getUpdates failed: ${data.description}`);
          await sleep(5_000);
          continue;
        }

        for (const update of data.result) {
          this.offset = update.update_id + 1;
          if (update.message) {
            this.dispatchMessage(update.message);
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // Expected on stop()
          break;
        }
        console.error(`[telegram] poll error:`, err);
        await sleep(5_000);
      }
    }
  }

  private dispatchMessage(msg: TelegramMessage): void {
    // Only relay messages from the configured chat
    if (String(msg.chat.id) !== this.chatId) return;

    for (const handler of this.handlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error(`[telegram] handler error:`, err);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
