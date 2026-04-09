/**
 * Telegram Bridge — Multi-Tenant Module
 *
 * Manages a single @claudemesh_bot instance with long-polling and a pool of
 * WebSocket connections (one per unique mesh). Multiple Telegram chats can
 * share the same mesh connection; push messages fan out to all chats.
 *
 * This file is self-contained. The broker's index.ts imports bootTelegramBridge
 * and connectChat, passing DB accessor callbacks so we never import db.ts.
 */

import { Bot, InputFile } from "grammy";
import WebSocket from "ws";
import sodium from "libsodium-wrappers";
import { validateTelegramConnectToken } from "./telegram-token";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BridgeRow {
  chatId: number;
  meshId: string;
  memberId: string;
  pubkey: string;
  secretKey: string;
  displayName: string;
  chatType: string;
  chatTitle: string | null;
}

interface MeshCredentials {
  meshId: string;
  memberId: string;
  pubkey: string;
  secretKey: string;
  displayName: string;
  brokerUrl: string;
}

interface PeerInfo {
  displayName: string;
  pubkey: string;
  status: string;
  summary?: string;
  cwd?: string;
  groups?: string[];
  avatar?: string;
}

// ---------------------------------------------------------------------------
// Crypto helpers (mirrors apps/telegram/src/index.ts)
// ---------------------------------------------------------------------------

let sodiumReady = false;

async function ensureSodium() {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
  return sodium;
}

async function generateSessionKeypair() {
  const s = await ensureSodium();
  const kp = s.crypto_sign_keypair();
  return {
    publicKey: s.to_hex(kp.publicKey),
    secretKey: s.to_hex(kp.privateKey),
  };
}

async function signHello(
  meshId: string,
  memberId: string,
  pubkey: string,
  secretKeyHex: string,
) {
  const s = await ensureSodium();
  const timestamp = Date.now();
  const canonical = `${meshId}|${memberId}|${pubkey}|${timestamp}`;
  const sig = s.crypto_sign_detached(
    s.from_string(canonical),
    s.from_hex(secretKeyHex),
  );
  return { timestamp, signature: s.to_hex(sig) };
}

async function decryptDirect(
  nonce: string,
  ciphertext: string,
  senderPubkeyHex: string,
  recipientSecretKeyHex: string,
): Promise<string | null> {
  const s = await ensureSodium();
  try {
    const senderPub = s.crypto_sign_ed25519_pk_to_curve25519(
      s.from_hex(senderPubkeyHex),
    );
    const recipientSec = s.crypto_sign_ed25519_sk_to_curve25519(
      s.from_hex(recipientSecretKeyHex),
    );
    const nonceBytes = s.from_base64(nonce, s.base64_variants.ORIGINAL);
    const ciphertextBytes = s.from_base64(
      ciphertext,
      s.base64_variants.ORIGINAL,
    );
    const plain = s.crypto_box_open_easy(
      ciphertextBytes,
      nonceBytes,
      senderPub,
      recipientSec,
    );
    return s.to_string(plain);
  } catch {
    return null;
  }
}

async function encryptDirect(
  message: string,
  recipientPubkeyHex: string,
  senderSecretKeyHex: string,
): Promise<{ nonce: string; ciphertext: string }> {
  const s = await ensureSodium();
  const recipientPub = s.crypto_sign_ed25519_pk_to_curve25519(
    s.from_hex(recipientPubkeyHex),
  );
  const senderSec = s.crypto_sign_ed25519_sk_to_curve25519(
    s.from_hex(senderSecretKeyHex),
  );
  const nonceBytes = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const ciphertextBytes = s.crypto_box_easy(
    s.from_string(message),
    nonceBytes,
    recipientPub,
    senderSec,
  );
  return {
    nonce: s.to_base64(nonceBytes, s.base64_variants.ORIGINAL),
    ciphertext: s.to_base64(ciphertextBytes, s.base64_variants.ORIGINAL),
  };
}

// ---------------------------------------------------------------------------
// MeshConnection — one WS per unique mesh, shared across chats
// ---------------------------------------------------------------------------

class MeshConnection {
  private ws: WebSocket | null = null;
  private creds: MeshCredentials;
  private sessionPubkey: string | null = null;
  private sessionSecretKey: string | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private resolvers = new Map<
    string,
    { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }
  >();
  /** pubkey/sessionPubkey → { name, avatar } */
  private peerInfo = new Map<string, { name: string; avatar?: string }>();
  private onPush: (meshId: string, from: string, text: string, priority: string) => void;
  private peerRefreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    creds: MeshCredentials,
    onPush: (meshId: string, from: string, text: string, priority: string) => void,
  ) {
    this.creds = creds;
    this.onPush = onPush;
  }

  async connect(): Promise<void> {
    const sessionKP = await generateSessionKeypair();
    this.sessionPubkey = sessionKP.publicKey;
    this.sessionSecretKey = sessionKP.secretKey;
    await this._connect();
    // Refresh peer name cache every 30 s
    this.peerRefreshInterval = setInterval(
      () => this.listPeers().catch(() => {}),
      30_000,
    );
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.creds.brokerUrl);
      this.ws = ws;

      ws.on("open", async () => {
        try {
          const { timestamp, signature } = await signHello(
            this.creds.meshId,
            this.creds.memberId,
            this.creds.pubkey,
            this.creds.secretKey,
          );
          ws.send(
            JSON.stringify({
              type: "hello",
              meshId: this.creds.meshId,
              memberId: this.creds.memberId,
              pubkey: this.creds.pubkey,
              sessionPubkey: this.sessionPubkey,
              displayName: this.creds.displayName,
              sessionId: `tg-bridge-${this.creds.meshId.slice(0, 8)}-${Date.now()}`,
              pid: process.pid,
              cwd: process.cwd(),
              hostname: require("os").hostname(),
              peerType: "bridge",
              channel: "telegram",
              timestamp,
              signature,
            }),
          );
        } catch (e) {
          reject(e);
        }
      });

      const helloTimeout = setTimeout(() => {
        ws.close();
        reject(new Error("hello_ack timeout"));
      }, 10_000);

      ws.on("message", async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (msg.type === "hello_ack") {
            clearTimeout(helloTimeout);
            this.connected = true;
            this.reconnectAttempt = 0;
            console.log(
              `[tg-bridge] WS connected to mesh ${this.creds.meshId.slice(0, 8)} as ${this.creds.displayName}`,
            );
            resolve();
            return;
          }

          // Push messages from peers → forward to Telegram
          if (msg.type === "push") {
            let text: string | null = null;
            const senderPubkey =
              msg.senderPubkey ?? msg.senderSessionPubkey;

            if (msg.subtype === "system") {
              const event = msg.event ?? "";
              const data = msg.eventData ?? {};
              if (event === "peer_joined")
                text = `[joined] ${data.displayName ?? "peer"}`;
              else if (event === "peer_left")
                text = `[left] ${data.displayName ?? "peer"}`;
              else if (event === "peer_returned")
                text = `[returned] ${data.name ?? "peer"}`;
              else text = msg.plaintext ?? `[${event}]`;
            } else if (senderPubkey && msg.nonce && msg.ciphertext) {
              // Try session key, then member key
              text =
                (await decryptDirect(
                  msg.nonce,
                  msg.ciphertext,
                  senderPubkey,
                  this.sessionSecretKey!,
                )) ??
                (await decryptDirect(
                  msg.nonce,
                  msg.ciphertext,
                  senderPubkey,
                  this.creds.secretKey,
                ));
              if (!text) text = "[could not decrypt]";
            } else if (msg.plaintext) {
              text = msg.plaintext;
            } else if (msg.ciphertext && !msg.nonce) {
              try {
                text = Buffer.from(msg.ciphertext, "base64").toString("utf-8");
              } catch {
                text = "[decode error]";
              }
            }

            if (text) {
              const info = senderPubkey
                ? this.peerInfo.get(senderPubkey)
                : null;
              const fromName =
                info?.name ?? senderPubkey?.slice(0, 12) ?? "system";
              const avatar = info?.avatar ?? "🤖";
              this.onPush(
                this.creds.meshId,
                `${avatar} ${fromName}`,
                text,
                msg.priority ?? "next",
              );
            }
          }

          // Resolve pending request/response pairs
          const reqId = msg._reqId;
          if (reqId && this.resolvers.has(reqId)) {
            const r = this.resolvers.get(reqId)!;
            clearTimeout(r.timer);
            this.resolvers.delete(reqId);
            r.resolve(msg);
          }
        } catch {
          /* ignore parse errors */
        }
      });

      ws.on("close", () => {
        this.connected = false;
        this.ws = null;
        if (this.reconnectTimer) return;
        const MAX_RECONNECT_ATTEMPTS = 20;
        if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
          console.error(
            `[tg-bridge] mesh ${this.creds.meshId.slice(0, 8)} giving up after ${MAX_RECONNECT_ATTEMPTS} attempts`,
          );
          meshConnections.delete(this.creds.meshId);
          return;
        }
        const delays = [1000, 2000, 4000, 8000, 16000, 30000];
        const delay =
          delays[Math.min(this.reconnectAttempt, delays.length - 1)]!;
        this.reconnectAttempt++;
        console.log(
          `[tg-bridge] mesh ${this.creds.meshId.slice(0, 8)} reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`,
        );
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this._connect().catch((e) =>
            console.error("[tg-bridge] reconnect failed:", e),
          );
        }, delay);
      });

      ws.on("error", (err) => {
        console.error(
          `[tg-bridge] WS error mesh ${this.creds.meshId.slice(0, 8)}:`,
          err.message,
        );
      });
    });
  }

  // -- Request / Response helpers --

  private makeReqId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  private request(
    msg: Record<string, unknown>,
    timeout = 10_000,
  ): Promise<any> {
    return new Promise((resolve) => {
      const reqId = this.makeReqId();
      const timer = setTimeout(() => {
        this.resolvers.delete(reqId);
        resolve(null);
      }, timeout);
      this.resolvers.set(reqId, { resolve, timer });
      this.ws?.send(JSON.stringify({ ...msg, _reqId: reqId }));
    });
  }

  // -- Public API --

  async sendMessage(
    to: string,
    message: string,
    priority = "next",
  ): Promise<boolean> {
    if (!this.ws || !this.connected) return false;

    const isDirect = /^[0-9a-f]{64}$/.test(to);
    let nonce = "";
    let ciphertext = "";

    if (isDirect) {
      const enc = await encryptDirect(
        message,
        to,
        this.sessionSecretKey!,
      );
      nonce = enc.nonce;
      ciphertext = enc.ciphertext;
    } else {
      ciphertext = Buffer.from(message, "utf-8").toString("base64");
    }

    this.ws.send(
      JSON.stringify({
        type: "send",
        id: this.makeReqId(),
        targetSpec: to,
        priority,
        nonce,
        ciphertext,
      }),
    );
    return true;
  }

  async listPeers(): Promise<PeerInfo[]> {
    const resp = await this.request({ type: "list_peers" });
    if (!resp?.peers) return [];
    return resp.peers.map((p: any) => {
      const name = p.displayName ?? p.pubkey?.slice(0, 12) ?? "?";
      const avatar = p.profile?.avatar;
      const info = { name, avatar };
      if (p.pubkey) this.peerInfo.set(p.pubkey, info);
      if (p.sessionPubkey) this.peerInfo.set(p.sessionPubkey, info);
      return {
        displayName: name,
        pubkey: p.pubkey ?? "",
        status: p.status ?? "unknown",
        summary: p.summary,
        cwd: p.cwd,
        groups: p.groups?.map((g: any) => g.name) ?? [],
        avatar,
      };
    });
  }

  async findPeersByName(name: string): Promise<PeerInfo[]> {
    const peers = await this.listPeers();
    return peers.filter(
      (p) => p.displayName.toLowerCase() === name.toLowerCase(),
    );
  }

  async setSummary(summary: string): Promise<void> {
    this.ws?.send(JSON.stringify({ type: "set_summary", summary }));
  }

  async uploadFile(
    data: Buffer,
    fileName: string,
    tags?: string[],
  ): Promise<string | null> {
    const brokerHttp = this.creds.brokerUrl
      .replace("wss://", "https://")
      .replace("ws://", "http://")
      .replace("/ws", "");
    try {
      const res = await fetch(`${brokerHttp}/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Mesh-Id": this.creds.meshId,
          "X-Member-Id": this.creds.memberId,
          "X-File-Name": fileName,
          "X-Tags": JSON.stringify(tags ?? ["telegram"]),
          "X-Persistent": "true",
        },
        body: data,
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        fileId?: string;
        error?: string;
      };
      if (!res.ok || !body.fileId) return null;
      return body.fileId;
    } catch (e) {
      console.error("[tg-bridge] upload failed:", e);
      return null;
    }
  }

  async getFileUrl(
    fileId: string,
  ): Promise<{ url: string; name: string } | null> {
    const resp = await this.request({ type: "get_file", fileId });
    if (!resp?.url) return null;
    return { url: resp.url, name: resp.name ?? "file" };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getMeshId(): string {
    return this.creds.meshId;
  }

  close(): void {
    if (this.peerRefreshInterval) clearInterval(this.peerRefreshInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

// ---------------------------------------------------------------------------
// Routing maps
// ---------------------------------------------------------------------------

/** chatId → meshIds this chat is connected to */
const chatMeshes = new Map<number, string[]>();

/** meshId → chatIds that should receive push messages */
const meshChats = new Map<string, Set<number>>();

/** meshId → shared WS connection */
const meshConnections = new Map<string, MeshConnection>();

// Pending DM picker state: chatId → { message, matches, meshId }
const pendingDMs = new Map<
  number,
  { message: string; matches: PeerInfo[]; meshId: string }
>();

/** Invite URL regex: https://claudemesh.com/join/<token> */
const INVITE_URL_RE =
  /https?:\/\/(?:www\.)?claudemesh\.com\/join\/([A-Za-z0-9_\-\.]+)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Add a chat ↔ mesh link to the in-memory maps. */
function linkChatMesh(chatId: number, meshId: string): void {
  const meshes = chatMeshes.get(chatId) ?? [];
  if (!meshes.includes(meshId)) {
    meshes.push(meshId);
    chatMeshes.set(chatId, meshes);
  }
  const chats = meshChats.get(meshId) ?? new Set();
  chats.add(chatId);
  meshChats.set(meshId, chats);
}

/** Remove a chat ↔ mesh link from in-memory maps. */
function unlinkChatMesh(chatId: number, meshId: string): void {
  const meshes = chatMeshes.get(chatId);
  if (meshes) {
    const idx = meshes.indexOf(meshId);
    if (idx !== -1) meshes.splice(idx, 1);
    if (meshes.length === 0) chatMeshes.delete(chatId);
  }
  const chats = meshChats.get(meshId);
  if (chats) {
    chats.delete(chatId);
    if (chats.size === 0) meshChats.delete(meshId);
  }
}

/**
 * Resolve which MeshConnection a chat command should target.
 * If the chat is connected to exactly one mesh, return it.
 * If connected to multiple and a prefix is given (e.g. "dev-team"),
 * match by meshId prefix. Otherwise return null (caller should prompt).
 */
function resolveMesh(
  chatId: number,
  meshPrefix?: string,
): MeshConnection | null {
  const meshIds = chatMeshes.get(chatId);
  if (!meshIds || meshIds.length === 0) return null;

  if (meshIds.length === 1) {
    return meshConnections.get(meshIds[0]!) ?? null;
  }

  if (meshPrefix) {
    const lower = meshPrefix.toLowerCase();
    const match = meshIds.find((id) => id.toLowerCase().startsWith(lower));
    if (match) return meshConnections.get(match) ?? null;
    // Also try partial match anywhere in the id
    const partial = meshIds.find((id) => id.toLowerCase().includes(lower));
    if (partial) return meshConnections.get(partial) ?? null;
  }

  return null;
}

/**
 * Parse an optional mesh prefix from command text.
 * Format: "meshSlug:rest" or "meshSlug rest" (for /peers etc.)
 * Returns [meshPrefix | undefined, remainingText].
 */
function parseMeshPrefix(
  chatId: number,
  text: string,
): [string | undefined, string] {
  const meshIds = chatMeshes.get(chatId);
  if (!meshIds || meshIds.length <= 1) return [undefined, text];

  // Try "slug:rest" format
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0 && colonIdx < 40) {
    return [text.slice(0, colonIdx), text.slice(colonIdx + 1).trimStart()];
  }

  // Try "slug rest" — only if first word matches a known meshId
  const spaceIdx = text.indexOf(" ");
  const firstWord = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
  const lower = firstWord.toLowerCase();
  const isSlug = meshIds.some(
    (id) =>
      id.toLowerCase().startsWith(lower) || id.toLowerCase().includes(lower),
  );
  if (isSlug) {
    return [
      firstWord,
      spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trimStart(),
    ];
  }

  return [undefined, text];
}

// ---------------------------------------------------------------------------
// Push handler — fan out mesh push to Telegram chats
// ---------------------------------------------------------------------------

function createPushHandler(bot: Bot) {
  return (
    meshId: string,
    from: string,
    text: string,
    _priority: string,
  ) => {
    const chatIds = meshChats.get(meshId);
    if (!chatIds || chatIds.size === 0) return;

    const meshLabel = meshId.slice(0, 12);
    const formatted = `💬 *[${meshLabel}] ${escapeMarkdown(from)}*\n${escapeMarkdown(text)}`;

    for (const chatId of chatIds) {
      bot.api
        .sendMessage(chatId, formatted, { parse_mode: "Markdown" })
        .catch((e) => {
          console.error(`[tg-bridge] send to chat ${chatId} failed:`, e.message);
        });
    }
  };
}

/** Escape Markdown v1 special chars for Telegram. */
function escapeMarkdown(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Bot command handlers
// ---------------------------------------------------------------------------

function setupBotCommands(
  bot: Bot,
  botToken: string,
  brokerUrl: string,
  saveBridge: (
    row: Omit<BridgeRow, "chatId"> & { chatId: number },
  ) => Promise<void>,
  deactivateBridge: (chatId: number, meshId: string) => Promise<void>,
  pushHandler: (
    meshId: string,
    from: string,
    text: string,
    priority: string,
  ) => void,
): void {
  // --- /start <token> ---
  bot.command("start", async (ctx) => {
    const token = ctx.match?.trim();
    if (!token) {
      await ctx.reply(
        "🔗 *Claudemesh Telegram Bridge*\n\n" +
          "Use a connect link from the dashboard or CLI to get started.\n" +
          "Or type /connect to link via email.\n\n" +
          "Commands: /help",
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Validate JWT signature, expiry, and claims
    const encKey = process.env.BROKER_ENCRYPTION_KEY;
    if (!encKey) {
      await ctx.reply("❌ Broker not configured for token validation.");
      return;
    }

    const payload = validateTelegramConnectToken(token, encKey);
    if (!payload) {
      await ctx.reply("❌ Invalid, expired, or tampered token. Request a new link.");
      return;
    }

    const { meshId, memberId, pubkey, secretKey, meshSlug } = payload;

    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const chatTitle =
      ctx.chat.type === "private"
        ? (ctx.from?.first_name ?? "Private")
        : ("title" in ctx.chat ? ctx.chat.title : null) ?? "Group";
    const displayName = `tg:${chatTitle}`;

    // Check if already connected
    const existing = chatMeshes.get(chatId);
    if (existing?.includes(meshId)) {
      await ctx.reply(`Already connected to mesh \`${meshSlug ?? meshId.slice(0, 8)}\`.`, {
        parse_mode: "Markdown",
      });
      return;
    }

    try {
      // Persist bridge row
      await saveBridge({
        chatId,
        meshId,
        memberId,
        pubkey,
        secretKey,
        displayName,
        chatType,
        chatTitle,
      });

      // Connect or reuse WS
      await ensureMeshConnection(
        { meshId, memberId, pubkey, secretKey, displayName, brokerUrl },
        pushHandler,
      );

      linkChatMesh(chatId, meshId);

      await ctx.reply(
        `✅ Connected to mesh *${escapeMarkdown(meshSlug ?? meshId.slice(0, 8))}*\\!`,
        { parse_mode: "MarkdownV2" },
      );
    } catch (e) {
      console.error("[tg-bridge] /start connect failed:", e);
      await ctx.reply("❌ Connection failed. Try again or request a new token.");
    }
  });

  // --- /connect (email flow stub) ---
  bot.command("connect", async (ctx) => {
    console.log("[tg-bridge] /connect requested — email flow not implemented yet");
    await ctx.reply(
      "📧 Email verification is not implemented yet.\n\n" +
        "Use a connect link from the dashboard or CLI instead:\n" +
        "`claudemesh connect telegram`",
      { parse_mode: "Markdown" },
    );
  });

  // --- /disconnect ---
  bot.command("disconnect", async (ctx) => {
    const chatId = ctx.chat.id;
    const meshIds = chatMeshes.get(chatId);
    if (!meshIds || meshIds.length === 0) {
      await ctx.reply("Not connected to any mesh.");
      return;
    }

    const [meshPrefix, _] = parseMeshPrefix(chatId, ctx.match ?? "");
    let targetMeshId: string | undefined;

    if (meshIds.length === 1) {
      targetMeshId = meshIds[0]!;
    } else if (meshPrefix) {
      const lower = meshPrefix.toLowerCase();
      targetMeshId = meshIds.find(
        (id) =>
          id.toLowerCase().startsWith(lower) ||
          id.toLowerCase().includes(lower),
      );
    }

    if (!targetMeshId && meshIds.length > 1) {
      const list = meshIds.map((id) => `• \`${id.slice(0, 12)}\``).join("\n");
      await ctx.reply(
        `Connected to multiple meshes. Specify which:\n${list}\n\n/disconnect <mesh-slug>`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (!targetMeshId) {
      await ctx.reply("Mesh not found.");
      return;
    }

    try {
      await deactivateBridge(chatId, targetMeshId);
      unlinkChatMesh(chatId, targetMeshId);

      // If no more chats reference this mesh, close the WS
      const remaining = meshChats.get(targetMeshId);
      if (!remaining || remaining.size === 0) {
        const conn = meshConnections.get(targetMeshId);
        if (conn) {
          conn.close();
          meshConnections.delete(targetMeshId);
        }
      }

      await ctx.reply(`✅ Disconnected from mesh \`${targetMeshId.slice(0, 12)}\`.`, {
        parse_mode: "Markdown",
      });
    } catch (e) {
      console.error("[tg-bridge] /disconnect failed:", e);
      await ctx.reply("❌ Disconnect failed.");
    }
  });

  // --- /meshes ---
  bot.command("meshes", async (ctx) => {
    const meshIds = chatMeshes.get(ctx.chat.id);
    if (!meshIds || meshIds.length === 0) {
      await ctx.reply("Not connected to any mesh. Use a connect link to join.");
      return;
    }
    const lines = meshIds.map((id) => {
      const conn = meshConnections.get(id);
      const status = conn?.isConnected() ? "🟢" : "🔴";
      return `${status} \`${id.slice(0, 16)}\``;
    });
    await ctx.reply(`*Connected meshes:*\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
  });

  // --- /peers [mesh-slug] ---
  bot.command("peers", async (ctx) => {
    const chatId = ctx.chat.id;
    const [meshPrefix] = parseMeshPrefix(chatId, ctx.match ?? "");
    const conn = resolveMesh(chatId, meshPrefix);

    if (!conn) {
      const meshIds = chatMeshes.get(chatId);
      if (!meshIds || meshIds.length === 0) {
        await ctx.reply("Not connected to any mesh.");
      } else {
        await ctx.reply(
          "Connected to multiple meshes. Specify which: /peers <mesh-slug>",
        );
      }
      return;
    }

    const peers = await conn.listPeers();
    if (peers.length === 0) {
      await ctx.reply("No peers online.");
      return;
    }
    const lines = peers.map((p) => {
      const icon =
        p.status === "idle" ? "🟢" : p.status === "working" ? "🟡" : "🔴";
      const summary = p.summary ? ` — _${escapeMarkdown(p.summary)}_` : "";
      return `${icon} *${escapeMarkdown(p.displayName)}*${summary}`;
    });
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // --- /dm [mesh:]<name> <message> ---
  bot.command("dm", async (ctx) => {
    const chatId = ctx.chat.id;
    const rawText = ctx.match ?? "";
    if (!rawText.trim()) {
      await ctx.reply("Usage: /dm <peer-name> <message>");
      return;
    }

    const [meshPrefix, text] = parseMeshPrefix(chatId, rawText);
    const conn = resolveMesh(chatId, meshPrefix);
    if (!conn) {
      const meshIds = chatMeshes.get(chatId);
      if (!meshIds || meshIds.length === 0) {
        await ctx.reply("Not connected to any mesh.");
      } else {
        await ctx.reply(
          "Connected to multiple meshes. Prefix with mesh slug: /dm mesh-slug:Mou hello",
        );
      }
      return;
    }

    const spaceIdx = text.indexOf(" ");
    if (spaceIdx === -1) {
      await ctx.reply("Usage: /dm <peer-name> <message>");
      return;
    }

    const target = text.slice(0, spaceIdx);
    const message = text.slice(spaceIdx + 1);
    const matches = await conn.findPeersByName(target);

    if (matches.length === 0) {
      await ctx.reply(`❌ No peer named "${target}" found.`);
      return;
    }

    if (matches.length === 1) {
      const ok = await conn.sendMessage(
        matches[0]!.pubkey,
        `[via Telegram] ${message}`,
        "now",
      );
      await ctx.reply(
        ok
          ? `✅ → ${matches[0]!.avatar ?? "🤖"} ${matches[0]!.displayName}`
          : "❌ Not connected",
      );
      return;
    }

    // Multiple matches — show inline keyboard picker
    pendingDMs.set(chatId, {
      message,
      matches,
      meshId: conn.getMeshId(),
    });
    const buttons = matches.map((p, i) => {
      const dir = p.cwd?.split("/").pop() ?? "?";
      const avatar = p.avatar ?? "🤖";
      return [
        { text: `${avatar} ${p.displayName} (${dir})`, callback_data: `dm:${i}` },
      ];
    });
    buttons.push([{ text: "📨 Send to ALL", callback_data: "dm:all" }]);
    await ctx.reply(`Multiple "${target}" peers online. Pick one or all:`, {
      reply_markup: { inline_keyboard: buttons },
    });
  });

  // --- /broadcast [mesh:] <message> ---
  bot.command("broadcast", async (ctx) => {
    const chatId = ctx.chat.id;
    const [meshPrefix, message] = parseMeshPrefix(chatId, ctx.match ?? "");
    if (!message.trim()) {
      await ctx.reply("Usage: /broadcast <message>");
      return;
    }
    const conn = resolveMesh(chatId, meshPrefix);
    if (!conn) {
      await ctx.reply("Not connected or specify mesh: /broadcast mesh-slug:hello");
      return;
    }
    const ok = await conn.sendMessage("*", `[via Telegram] ${message}`, "now");
    await ctx.reply(ok ? "✅ Broadcast sent" : "❌ Not connected");
  });

  // --- /group [mesh:]@name <message> ---
  bot.command("group", async (ctx) => {
    const chatId = ctx.chat.id;
    const [meshPrefix, text] = parseMeshPrefix(chatId, ctx.match ?? "");
    if (!text.trim()) {
      await ctx.reply("Usage: /group @group-name <message>");
      return;
    }
    const spaceIdx = text.indexOf(" ");
    if (spaceIdx === -1) {
      await ctx.reply("Usage: /group @group-name <message>");
      return;
    }
    const target = text.slice(0, spaceIdx);
    const message = text.slice(spaceIdx + 1);
    const conn = resolveMesh(chatId, meshPrefix);
    if (!conn) {
      await ctx.reply("Not connected or specify mesh.");
      return;
    }
    const ok = await conn.sendMessage(target, `[via Telegram] ${message}`, "now");
    await ctx.reply(ok ? `✅ Sent to ${target}` : "❌ Not connected");
  });

  // --- /file <id> ---
  bot.command("file", async (ctx) => {
    const chatId = ctx.chat.id;
    const fileId = ctx.match?.trim();
    if (!fileId) {
      await ctx.reply("Usage: /file <file-id>");
      return;
    }

    // Try all connected meshes for this chat
    const meshIds = chatMeshes.get(chatId) ?? [];
    for (const meshId of meshIds) {
      const conn = meshConnections.get(meshId);
      if (!conn?.isConnected()) continue;
      const file = await conn.getFileUrl(fileId);
      if (!file) continue;
      try {
        const resp = await fetch(file.url, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) continue;
        const buf = Buffer.from(await resp.arrayBuffer());
        await ctx.replyWithDocument(new InputFile(buf, file.name));
        return;
      } catch {
        continue;
      }
    }
    await ctx.reply(`❌ File \`${fileId}\` not found in any connected mesh.`, {
      parse_mode: "Markdown",
    });
  });

  // --- /status ---
  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    const meshIds = chatMeshes.get(chatId);
    if (!meshIds || meshIds.length === 0) {
      await ctx.reply("Not connected to any mesh.");
      return;
    }
    const lines = meshIds.map((id) => {
      const conn = meshConnections.get(id);
      const icon = conn?.isConnected() ? "🟢" : "🔴";
      return `${icon} \`${id.slice(0, 16)}\``;
    });
    await ctx.reply(
      `*Claudemesh Telegram Bridge*\n${lines.join("\n")}`,
      { parse_mode: "Markdown" },
    );
  });

  // --- /help ---
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "🔗 *Claudemesh Telegram Bridge*\n\n" +
        "*Commands:*\n" +
        "• /start <token> — Connect via deep link\n" +
        "• /connect — Link via email (coming soon)\n" +
        "• /disconnect — Disconnect from mesh\n" +
        "• /meshes — List connected meshes\n" +
        "• /peers — List online peers\n" +
        "• /dm <name> <msg> — DM a peer\n" +
        "• /broadcast <msg> — Message all peers\n" +
        "• /group @name <msg> — Message a group\n" +
        "• /file <id> — Download a mesh file\n" +
        "• /status — Connection status\n\n" +
        "_Multi-mesh: prefix commands with mesh slug_\n" +
        "`/peers dev-team` or `/dm dev-team:Mou hello`",
      { parse_mode: "Markdown" },
    );
  });

  // --- Callback query handler (peer picker inline keyboard) ---
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id;
    if (!chatId || !data.startsWith("dm:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    const pending = pendingDMs.get(chatId);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Session expired. Send /dm again." });
      return;
    }

    const conn = meshConnections.get(pending.meshId);
    if (!conn?.isConnected()) {
      pendingDMs.delete(chatId);
      await ctx.answerCallbackQuery({ text: "Not connected." });
      return;
    }

    if (data === "dm:all") {
      let sent = 0;
      for (const p of pending.matches) {
        const ok = await conn.sendMessage(
          p.pubkey,
          `[via Telegram] ${pending.message}`,
          "now",
        );
        if (ok) sent++;
      }
      pendingDMs.delete(chatId);
      await ctx.answerCallbackQuery({ text: `Sent to ${sent} peers` });
      await ctx.editMessageText(
        `✅ Sent to all ${sent} ${pending.matches[0]?.displayName ?? "?"} peers`,
      );
      return;
    }

    const idx = parseInt(data.slice(3));
    const peer = pending.matches[idx];
    if (!peer) {
      await ctx.answerCallbackQuery({ text: "Invalid selection" });
      return;
    }

    const ok = await conn.sendMessage(
      peer.pubkey,
      `[via Telegram] ${pending.message}`,
      "now",
    );
    pendingDMs.delete(chatId);
    const dir = peer.cwd?.split("/").pop() ?? "?";
    await ctx.answerCallbackQuery({ text: ok ? "Sent!" : "Failed" });
    await ctx.editMessageText(
      ok
        ? `✅ → ${peer.avatar ?? "🤖"} ${peer.displayName} (${dir})`
        : "❌ Not connected",
    );
  });

  // --- Photo upload → mesh file sharing ---
  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;
    const meshIds = chatMeshes.get(chatId);
    if (!meshIds || meshIds.length === 0) return;

    const photo = ctx.message.photo.at(-1);
    if (!photo) return;

    try {
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const resp = await fetch(url);
      const buf = Buffer.from(await resp.arrayBuffer());
      const name = `telegram-photo-${Date.now()}.jpg`;
      const caption = ctx.message.caption
        ? ` — "${ctx.message.caption}"`
        : "";

      let shared = 0;
      for (const meshId of meshIds) {
        const conn = meshConnections.get(meshId);
        if (!conn?.isConnected()) continue;
        const fileId = await conn.uploadFile(buf, name, [
          "telegram",
          "photo",
        ]);
        if (fileId) {
          await conn.sendMessage(
            "*",
            `[via Telegram] 📷 Photo shared${caption} (file: ${fileId})`,
            "next",
          );
          shared++;
        }
      }
      await ctx.reply(
        shared > 0
          ? `✅ Photo shared to ${shared} mesh${shared > 1 ? "es" : ""}`
          : "❌ Upload failed",
      );
    } catch (e) {
      await ctx.reply(
        `❌ ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  // --- Document upload → mesh file sharing ---
  bot.on("message:document", async (ctx) => {
    const chatId = ctx.chat.id;
    const meshIds = chatMeshes.get(chatId);
    if (!meshIds || meshIds.length === 0) return;

    const doc = ctx.message.document;
    if (!doc) return;

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const resp = await fetch(url);
      const buf = Buffer.from(await resp.arrayBuffer());
      const name = doc.file_name ?? `telegram-file-${Date.now()}`;
      const caption = ctx.message.caption
        ? ` — "${ctx.message.caption}"`
        : "";

      let shared = 0;
      for (const meshId of meshIds) {
        const conn = meshConnections.get(meshId);
        if (!conn?.isConnected()) continue;
        const fileId = await conn.uploadFile(buf, name, [
          "telegram",
          "document",
        ]);
        if (fileId) {
          await conn.sendMessage(
            "*",
            `[via Telegram] 📎 File shared: ${name}${caption} (file: ${fileId})`,
            "next",
          );
          shared++;
        }
      }
      await ctx.reply(
        shared > 0
          ? `✅ File shared to ${shared} mesh${shared > 1 ? "es" : ""}: ${name}`
          : "❌ Upload failed",
      );
    } catch (e) {
      await ctx.reply(
        `❌ ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  // --- Default text handler: invite URL detection, @mentions, broadcast ---
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // Skip unknown commands

    // --- Invite URL detection ---
    const inviteMatch = text.match(INVITE_URL_RE);
    if (inviteMatch) {
      const inviteToken = inviteMatch[1]!;
      await ctx.reply(
        `🔗 Detected invite link.\n\nTo connect, use the deep link from the dashboard or CLI.\nInvite token: \`${inviteToken}\``,
        { parse_mode: "Markdown" },
      );
      return;
    }

    const meshIds = chatMeshes.get(chatId);
    if (!meshIds || meshIds.length === 0) {
      // Not connected — ignore non-command messages
      return;
    }

    // --- @Mention pattern: "@PeerName message" ---
    const mentionMatch = text.match(/^@(\S+)\s+([\s\S]+)$/);
    if (mentionMatch) {
      const target = mentionMatch[1]!;
      const message = mentionMatch[2]!;

      // For multi-mesh, try all connections
      for (const meshId of meshIds) {
        const conn = meshConnections.get(meshId);
        if (!conn?.isConnected()) continue;
        const matches = await conn.findPeersByName(target);
        if (matches.length === 0) continue;

        if (matches.length === 1) {
          const ok = await conn.sendMessage(
            matches[0]!.pubkey,
            `[via Telegram] ${message}`,
            "now",
          );
          await ctx.reply(
            ok
              ? `✅ → ${matches[0]!.avatar ?? "🤖"} ${matches[0]!.displayName}`
              : "❌ Not connected",
          );
          return;
        }

        // Multiple matches — picker
        pendingDMs.set(chatId, { message, matches, meshId });
        const buttons = matches.map((p, i) => {
          const dir = p.cwd?.split("/").pop() ?? "?";
          return [
            {
              text: `${p.avatar ?? "🤖"} ${p.displayName} (${dir})`,
              callback_data: `dm:${i}`,
            },
          ];
        });
        buttons.push([
          { text: "📨 Send to ALL", callback_data: "dm:all" },
        ]);
        await ctx.reply(
          `Multiple "${target}" peers. Pick one or all:`,
          { reply_markup: { inline_keyboard: buttons } },
        );
        return;
      }

      await ctx.reply(`❌ No peer named "${target}" in any connected mesh.`);
      return;
    }

    // --- No mention → broadcast to all connected meshes ---
    let sent = 0;
    for (const meshId of meshIds) {
      const conn = meshConnections.get(meshId);
      if (!conn?.isConnected()) continue;
      const ok = await conn.sendMessage(
        "*",
        `[via Telegram] ${text}`,
        "next",
      );
      if (ok) sent++;
    }
    if (sent === 0) {
      await ctx.reply("❌ Not connected to any mesh.");
    }
  });
}

// ---------------------------------------------------------------------------
// Ensure a mesh WS connection exists (create or reuse)
// ---------------------------------------------------------------------------

async function ensureMeshConnection(
  creds: MeshCredentials,
  pushHandler: (
    meshId: string,
    from: string,
    text: string,
    priority: string,
  ) => void,
): Promise<MeshConnection> {
  const existing = meshConnections.get(creds.meshId);
  if (existing?.isConnected()) return existing;

  // Close stale connection if any
  if (existing) {
    existing.close();
    meshConnections.delete(creds.meshId);
  }

  const conn = new MeshConnection(creds, pushHandler);
  meshConnections.set(creds.meshId, conn);
  await conn.connect();
  await conn.setSummary(
    "Telegram bridge — relays messages between Telegram chats and mesh peers",
  );
  return conn;
}

// ---------------------------------------------------------------------------
// Boot — called by broker on startup
// ---------------------------------------------------------------------------

export async function bootTelegramBridge(
  loadActiveBridges: () => Promise<BridgeRow[]>,
  saveBridge: (
    row: Omit<BridgeRow, "chatId"> & { chatId: number },
  ) => Promise<void>,
  deactivateBridge: (chatId: number, meshId: string) => Promise<void>,
  botToken: string,
  brokerUrl: string,
): Promise<void> {
  await ensureSodium();

  const bot = new Bot(botToken);
  const pushHandler = createPushHandler(bot);

  // Load all active bridges from DB
  const rows = await loadActiveBridges();
  console.log(`[tg-bridge] loaded ${rows.length} active bridge(s) from DB`);

  // Group by meshId to connect WS pool
  const byMesh = new Map<string, BridgeRow[]>();
  for (const row of rows) {
    const arr = byMesh.get(row.meshId) ?? [];
    arr.push(row);
    byMesh.set(row.meshId, arr);
  }

  // Connect one WS per unique mesh
  for (const [meshId, meshRows] of byMesh) {
    const first = meshRows[0]!;
    try {
      await ensureMeshConnection(
        {
          meshId,
          memberId: first.memberId,
          pubkey: first.pubkey,
          secretKey: first.secretKey,
          displayName: first.displayName,
          brokerUrl,
        },
        pushHandler,
      );
      console.log(
        `[tg-bridge] connected WS for mesh ${meshId.slice(0, 8)} (${meshRows.length} chat(s))`,
      );
    } catch (e) {
      console.error(
        `[tg-bridge] failed to connect mesh ${meshId.slice(0, 8)}:`,
        e,
      );
    }

    // Populate routing maps for all chats in this mesh
    for (const row of meshRows) {
      linkChatMesh(row.chatId, meshId);
    }
  }

  // Grammy global error handler — prevents unhandled rejections from crashing broker
  bot.catch((err) => {
    console.error("[tg-bridge] Grammy error:", err.message ?? err);
  });

  // Expire stale pendingDMs entries every 5 minutes (prevent memory leak)
  setInterval(() => {
    // pendingDMs has no timestamp, so we just cap size — clear all if > 1000
    if (pendingDMs.size > 1000) {
      console.warn(`[tg-bridge] clearing ${pendingDMs.size} stale pendingDMs`);
      pendingDMs.clear();
    }
  }, 5 * 60_000).unref();

  // Wire up bot commands
  setupBotCommands(
    bot,
    botToken,
    brokerUrl,
    saveBridge,
    deactivateBridge,
    pushHandler,
  );

  // Start Grammy long-polling (fire-and-forget, must not crash broker)
  console.log("[tg-bridge] starting bot...");
  bot.start({
    onStart: () =>
      console.log(
        `[tg-bridge] bot running — ${meshConnections.size} mesh(es), ${chatMeshes.size} chat(s)`,
      ),
  }).catch((err: unknown) => {
    console.error("[tg-bridge] bot.start() error:", err instanceof Error ? err.message : String(err));
  });
}

// ---------------------------------------------------------------------------
// Connect a new chat at runtime (called from broker HTTP endpoints)
// ---------------------------------------------------------------------------

export async function connectChat(
  chatId: number,
  chatType: string,
  chatTitle: string | null,
  meshCreds: MeshCredentials,
  pushHandler?: (
    meshId: string,
    from: string,
    text: string,
    priority: string,
  ) => void,
): Promise<void> {
  // Default push handler is a no-op if bot isn't running yet
  // (the real one is wired during bootTelegramBridge)
  const handler = pushHandler ?? (() => {});

  await ensureMeshConnection(meshCreds, handler);
  linkChatMesh(chatId, meshCreds.meshId);

  console.log(
    `[tg-bridge] chat ${chatId} (${chatType}) connected to mesh ${meshCreds.meshId.slice(0, 8)}`,
  );
}
