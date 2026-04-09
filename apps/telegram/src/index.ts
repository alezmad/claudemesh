/**
 * Claudemesh ↔ Telegram Bridge
 *
 * Joins the mesh as a peer named "telegram-bridge", relays messages
 * between a Telegram chat and mesh peers.
 *
 * Telegram → Mesh:
 *   "@Mou fix the bug"  → send_message(to: "Mou", message: "fix the bug")
 *   "/peers"            → list_peers → reply with online list
 *   "/broadcast hello"  → send_message(to: "*", message: "hello")
 *   "any text"          → send_message(to: "*", message: text) (broadcast)
 *
 * Mesh → Telegram:
 *   Any push message addressed to this peer → forward to Telegram chat
 */

import { Bot, InputFile } from "grammy";
import WebSocket from "ws";
import sodium from "libsodium-wrappers";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// --- Config ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS ?? "").split(",").filter(Boolean).map(Number);
const CONFIG_DIR = process.env.CLAUDEMESH_CONFIG_DIR ?? join(homedir(), ".claudemesh");
const DISPLAY_NAME = process.env.BRIDGE_NAME ?? "telegram-bridge";

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN required");
  process.exit(1);
}

// --- Load mesh config ---
interface JoinedMesh {
  meshId: string;
  memberId: string;
  slug: string;
  name: string;
  pubkey: string;
  secretKey: string;
  brokerUrl: string;
}

function loadMeshConfig(): JoinedMesh[] {
  // Support env-based config for Docker/VPS deployment
  if (process.env.MESH_ID && process.env.MESH_MEMBER_ID && process.env.MESH_PUBKEY && process.env.MESH_SECRET_KEY) {
    return [{
      meshId: process.env.MESH_ID,
      memberId: process.env.MESH_MEMBER_ID,
      slug: process.env.MESH_SLUG ?? "mesh",
      name: process.env.MESH_NAME ?? "mesh",
      pubkey: process.env.MESH_PUBKEY,
      secretKey: process.env.MESH_SECRET_KEY,
      brokerUrl: process.env.MESH_BROKER_URL ?? "wss://ic.claudemesh.com/ws",
    }];
  }
  // Fall back to config file
  const path = join(CONFIG_DIR, "config.json");
  if (!existsSync(path)) {
    console.error(`No config at ${path} — set MESH_ID/MESH_MEMBER_ID/MESH_PUBKEY/MESH_SECRET_KEY env vars or run 'claudemesh join' first`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(path, "utf-8"));
  return config.meshes ?? [];
}

// --- Crypto ---
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

async function signHello(meshId: string, memberId: string, pubkey: string, secretKeyHex: string) {
  const s = await ensureSodium();
  const timestamp = Date.now();
  const canonical = `${meshId}|${memberId}|${pubkey}|${timestamp}`;
  const sig = s.crypto_sign_detached(s.from_string(canonical), s.from_hex(secretKeyHex));
  return { timestamp, signature: s.to_hex(sig) };
}

/** Decrypt a direct message envelope using crypto_box (X25519). */
async function decryptDirect(
  nonce: string,
  ciphertext: string,
  senderPubkeyHex: string,
  recipientSecretKeyHex: string,
): Promise<string | null> {
  const s = await ensureSodium();
  try {
    const senderPub = s.crypto_sign_ed25519_pk_to_curve25519(s.from_hex(senderPubkeyHex));
    const recipientSec = s.crypto_sign_ed25519_sk_to_curve25519(s.from_hex(recipientSecretKeyHex));
    const nonceBytes = s.from_base64(nonce, s.base64_variants.ORIGINAL);
    const ciphertextBytes = s.from_base64(ciphertext, s.base64_variants.ORIGINAL);
    const plain = s.crypto_box_open_easy(ciphertextBytes, nonceBytes, senderPub, recipientSec);
    return s.to_string(plain);
  } catch {
    return null;
  }
}

// --- Mesh WS Client (simplified) ---
interface PeerInfo {
  displayName: string;
  pubkey: string;
  status: string;
  summary?: string;
  cwd?: string;
  groups?: string[];
  avatar?: string;
}

class MeshBridge {
  private ws: WebSocket | null = null;
  private mesh: JoinedMesh;
  private sessionPubkey: string | null = null;
  private sessionSecretKey: string | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private onMessage: (from: string, text: string, priority: string) => void;
  private resolvers = new Map<string, { resolve: (v: any) => void; timer: NodeJS.Timeout }>();
  /** Map pubkey → {name, avatar}, populated from list_peers */
  private peerInfo = new Map<string, { name: string; avatar?: string }>();

  constructor(mesh: JoinedMesh, onMessage: (from: string, text: string, priority: string) => void) {
    this.mesh = mesh;
    this.onMessage = onMessage;
  }

  async connect(): Promise<void> {
    const sessionKP = await generateSessionKeypair();
    this.sessionPubkey = sessionKP.publicKey;
    this.sessionSecretKey = sessionKP.secretKey;
    return this._connect();
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.mesh.brokerUrl);
      this.ws = ws;

      ws.on("open", async () => {
        try {
          const { timestamp, signature } = await signHello(
            this.mesh.meshId, this.mesh.memberId,
            this.mesh.pubkey, this.mesh.secretKey,
          );
          ws.send(JSON.stringify({
            type: "hello",
            meshId: this.mesh.meshId,
            memberId: this.mesh.memberId,
            pubkey: this.mesh.pubkey,
            sessionPubkey: this.sessionPubkey,
            displayName: DISPLAY_NAME,
            sessionId: `telegram-${process.pid}-${Date.now()}`,
            pid: process.pid,
            cwd: process.cwd(),
            hostname: require("os").hostname(),
            peerType: "bridge",
            channel: "telegram",
            timestamp,
            signature,
          }));
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
          if (msg.type !== "hello_ack" && msg.type !== "ack") {
            console.log(`[mesh] recv: ${msg.type}${msg.subtype ? '/' + msg.subtype : ''}${msg.event ? '/' + msg.event : ''}`);
          }

          if (msg.type === "hello_ack") {
            clearTimeout(helloTimeout);
            this.connected = true;
            this.reconnectAttempt = 0;
            console.log(`[mesh] connected to ${this.mesh.slug} as ${DISPLAY_NAME}`);
            resolve();
            return;
          }

          // Push messages from peers
          if (msg.type === "push") {
            let text: string | null = null;
            const senderPubkey = msg.senderPubkey ?? msg.senderSessionPubkey;

            // System messages (no encryption)
            if (msg.subtype === "system") {
              const event = msg.event ?? "";
              const data = msg.eventData ?? {};
              if (event === "peer_joined") text = `[joined] ${data.displayName ?? "peer"}`;
              else if (event === "peer_left") text = `[left] ${data.displayName ?? "peer"}`;
              else if (event === "peer_returned") text = `[returned] ${data.name ?? "peer"}`;
              else text = msg.plaintext ?? `[${event}]`;
            }
            // Encrypted direct message
            else if (senderPubkey && msg.nonce && msg.ciphertext) {
              // Try session key first, then mesh member key
              text = await decryptDirect(msg.nonce, msg.ciphertext, senderPubkey, this.sessionSecretKey!)
                ?? await decryptDirect(msg.nonce, msg.ciphertext, senderPubkey, this.mesh.secretKey);
              if (!text) text = "[could not decrypt]";
            }
            // Plaintext fallback (broadcasts, legacy)
            else if (msg.plaintext) {
              text = msg.plaintext;
            }
            // Base64 ciphertext without nonce (legacy broadcast)
            else if (msg.ciphertext && !msg.nonce) {
              try { text = Buffer.from(msg.ciphertext, "base64").toString("utf-8"); } catch { text = "[decode error]"; }
            }

            if (text) {
              const info = senderPubkey ? this.peerInfo.get(senderPubkey) : null;
              const fromName = info?.name ?? (senderPubkey?.slice(0, 12) ?? "system");
              const avatar = info?.avatar ?? "🤖";
              console.log(`[mesh] push from ${avatar} ${fromName}: ${text.slice(0, 80)}`);
              this.onMessage(`${avatar} ${fromName}`, text, msg.priority ?? "next");
            } else {
              console.log(`[mesh] push with no text. subtype=${msg.subtype}, hasSender=${!!senderPubkey}, hasNonce=${!!msg.nonce}, hasCipher=${!!msg.ciphertext}, hasPlain=${!!msg.plaintext}`);
            }
          }

          // Resolve pending requests
          const reqId = msg._reqId;
          if (reqId && this.resolvers.has(reqId)) {
            const r = this.resolvers.get(reqId)!;
            clearTimeout(r.timer);
            this.resolvers.delete(reqId);
            r.resolve(msg);
          }
        } catch { /* ignore parse errors */ }
      });

      ws.on("close", () => {
        this.connected = false;
        this.ws = null;
        if (this.reconnectTimer) return;
        const delays = [1000, 2000, 4000, 8000, 16000, 30000];
        const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)]!;
        this.reconnectAttempt++;
        console.log(`[mesh] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this._connect().catch(e => console.error("[mesh] reconnect failed:", e));
        }, delay);
      });

      ws.on("error", (err) => {
        console.error("[mesh] ws error:", err.message);
      });
    });
  }

  private makeReqId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  private request(msg: Record<string, unknown>, timeout = 10_000): Promise<any> {
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

  async sendMessage(to: string, message: string, priority: string = "next"): Promise<boolean> {
    if (!this.ws || !this.connected) return false;

    // For direct targets (pubkeys), use crypto_box encryption.
    // For broadcasts/groups, use base64-encoded plaintext (legacy format).
    let nonce = "";
    let ciphertext = "";
    const isDirect = /^[0-9a-f]{64}$/.test(to);
    if (isDirect) {
      const s = await ensureSodium();
      const recipientPub = s.crypto_sign_ed25519_pk_to_curve25519(s.from_hex(to));
      const senderSec = s.crypto_sign_ed25519_sk_to_curve25519(s.from_hex(this.sessionSecretKey!));
      const nonceBytes = s.randombytes_buf(s.crypto_box_NONCEBYTES);
      const ciphertextBytes = s.crypto_box_easy(s.from_string(message), nonceBytes, recipientPub, senderSec);
      nonce = s.to_base64(nonceBytes, s.base64_variants.ORIGINAL);
      ciphertext = s.to_base64(ciphertextBytes, s.base64_variants.ORIGINAL);
    } else {
      // Broadcast/group: base64 plaintext (CLI decodes this when no nonce present)
      ciphertext = Buffer.from(message, "utf-8").toString("base64");
    }

    const id = this.makeReqId();
    console.log(`[mesh] sending to ${to.slice(0, 16)}…, encrypted=${isDirect}`);
    this.ws.send(JSON.stringify({
      type: "send",
      id,
      targetSpec: to,
      priority,
      nonce,
      ciphertext,
    }));
    return true;
  }

  /** Find all peers matching a display name. */
  async findPeersByName(name: string): Promise<PeerInfo[]> {
    const peers = await this.listPeers();
    return peers.filter(p => p.displayName.toLowerCase() === name.toLowerCase());
  }

  /** Upload a file to the mesh via broker HTTP. Returns file ID. */
  async uploadFile(data: Buffer, fileName: string, tags?: string[]): Promise<string | null> {
    const brokerHttp = this.mesh.brokerUrl.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");
    try {
      const res = await fetch(`${brokerHttp}/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Mesh-Id": this.mesh.meshId,
          "X-Member-Id": this.mesh.memberId,
          "X-File-Name": fileName,
          "X-Tags": JSON.stringify(tags ?? ["telegram"]),
          "X-Persistent": "true",
        },
        body: data,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json() as { ok?: boolean; fileId?: string; error?: string };
      if (!res.ok || !body.fileId) return null;
      return body.fileId;
    } catch (e) {
      console.error("[mesh] upload failed:", e);
      return null;
    }
  }

  /** Get a download URL for a mesh file. */
  async getFileUrl(fileId: string): Promise<{ url: string; name: string } | null> {
    const resp = await this.request({ type: "get_file", fileId });
    if (!resp?.url) return null;
    return { url: resp.url, name: resp.name ?? "file" };
  }

  async listPeers(): Promise<PeerInfo[]> {
    const resp = await this.request({ type: "list_peers" });
    if (!resp?.peers) return [];
    return resp.peers.map((p: any) => {
      const name = p.displayName ?? p.pubkey?.slice(0, 12) ?? "?";
      const avatar = p.profile?.avatar;
      // Cache pubkey → info for push message attribution
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
        avatar: avatar,
      };
    });
  }

  /** Refresh peer name cache. Called periodically. */
  async refreshPeerNames(): Promise<void> {
    await this.listPeers();
  }

  async setSummary(summary: string): Promise<void> {
    this.ws?.send(JSON.stringify({ type: "set_summary", summary }));
  }

  isConnected(): boolean {
    return this.connected;
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

// --- Resolve display name from peers ---
async function resolveTarget(bridge: MeshBridge, name: string): Promise<string> {
  // If it starts with @, it's a group
  if (name.startsWith("@")) return name;
  // If *, broadcast
  if (name === "*") return "*";
  // Otherwise resolve as display name — the broker handles this via targetSpec
  return name;
}

// --- Telegram Bot ---
async function main() {
  const meshes = loadMeshConfig();
  if (meshes.length === 0) {
    console.error("No meshes joined — run 'claudemesh join' first");
    process.exit(1);
  }

  const bot = new Bot(BOT_TOKEN);
  const bridges: MeshBridge[] = [];

  // One bridge per mesh
  for (const mesh of meshes) {
    const bridge = new MeshBridge(mesh, (from, text, priority) => {
      // Forward mesh messages to all allowed Telegram chats
      const prefix = `[${mesh.slug}] ${from}`;
      const formatted = `💬 *${prefix}*\n${text}`;
      for (const chatId of ALLOWED_CHAT_IDS) {
        bot.api.sendMessage(chatId, formatted, { parse_mode: "Markdown" }).catch(e => {
          console.error(`[tg] failed to send to ${chatId}:`, e.message);
        });
      }
    });

    try {
      await bridge.connect();
      await bridge.setSummary("Telegram bridge — relays messages between Telegram and mesh peers");
      await bridge.refreshPeerNames();
      bridges.push(bridge);
      // Refresh peer names every 30s for display name resolution on pushes
      setInterval(() => bridge.refreshPeerNames().catch(() => {}), 30_000);
    } catch (e) {
      console.error(`[mesh] failed to connect to ${mesh.slug}:`, e);
    }
  }

  if (bridges.length === 0) {
    console.error("Failed to connect to any mesh");
    process.exit(1);
  }

  const defaultBridge = bridges[0]!;

  // --- Bot commands ---

  bot.command("peers", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const peers = await defaultBridge.listPeers();
    if (peers.length === 0) {
      await ctx.reply("No peers online.");
      return;
    }
    const lines = peers.map(p => {
      const status = p.status === "idle" ? "🟢" : p.status === "working" ? "🟡" : "🔴";
      const summary = p.summary ? ` — _${p.summary}_` : "";
      return `${status} *${p.displayName}*${summary}`;
    });
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // Pending messages waiting for peer selection (chatId → {message, matches})
  const pendingDMs = new Map<number, { message: string; matches: PeerInfo[]; selected: Set<number> }>();

  bot.command("dm", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: /dm <peer-name> <message>");
      return;
    }
    const spaceIdx = text.indexOf(" ");
    if (spaceIdx === -1) {
      await ctx.reply("Usage: /dm <peer-name> <message>");
      return;
    }
    const target = text.slice(0, spaceIdx);
    const message = text.slice(spaceIdx + 1);

    // Find matching peers
    const matches = await defaultBridge.findPeersByName(target);
    if (matches.length === 0) {
      await ctx.reply(`❌ No peer named "${target}" found.`);
      return;
    }
    if (matches.length === 1) {
      // Single match — send directly
      const ok = await defaultBridge.sendMessage(matches[0]!.pubkey, `[via Telegram] ${message}`, "now");
      await ctx.reply(ok ? `✅ → ${matches[0]!.avatar ?? "🤖"} ${matches[0]!.displayName}` : "❌ Not connected");
      return;
    }
    // Multiple matches — show picker with individual + all option
    pendingDMs.set(ctx.chat.id, { message, matches, selected: new Set() });
    const buttons = matches.map((p, i) => {
      const dir = p.cwd?.split("/").pop() ?? "?";
      const avatar = p.avatar ?? "🤖";
      return [{ text: `${avatar} ${p.displayName} (${dir})`, callback_data: `dm:${i}` }];
    });
    buttons.push([{ text: "📨 Send to ALL", callback_data: "dm:all" }]);
    await ctx.reply(`Multiple "${target}" peers online. Pick one or all:`, {
      reply_markup: { inline_keyboard: buttons },
    });
  });

  bot.command("broadcast", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const message = ctx.match;
    if (!message) {
      await ctx.reply("Usage: /broadcast <message>");
      return;
    }
    const ok = await defaultBridge.sendMessage("*", `[via Telegram] ${message}`, "now");
    await ctx.reply(ok ? "✅ Broadcast sent" : "❌ Not connected");
  });

  bot.command("group", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: /group <@group-name> <message>");
      return;
    }
    const spaceIdx = text.indexOf(" ");
    if (spaceIdx === -1) {
      await ctx.reply("Usage: /group <@group-name> <message>");
      return;
    }
    const target = text.slice(0, spaceIdx);
    const message = text.slice(spaceIdx + 1);
    const ok = await defaultBridge.sendMessage(target, `[via Telegram] ${message}`, "now");
    await ctx.reply(ok ? `✅ Sent to ${target}` : "❌ Not connected");
  });

  bot.command("status", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const meshStatus = bridges.map(b =>
      `${b.isConnected() ? "🟢" : "🔴"} Connected`
    ).join("\n");
    await ctx.reply(`*Claudemesh Telegram Bridge*\n${meshStatus}`, { parse_mode: "Markdown" });
  });

  // --- File: get a mesh file by ID ---
  bot.command("file", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const fileId = ctx.match?.trim();
    if (!fileId) {
      await ctx.reply("Usage: /file <file-id>");
      return;
    }
    const file = await defaultBridge.getFileUrl(fileId);
    if (!file) {
      await ctx.reply(`❌ File ${fileId} not found`);
      return;
    }
    try {
      const resp = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) { await ctx.reply(`❌ Download failed (${resp.status})`); return; }
      const buf = Buffer.from(await resp.arrayBuffer());
      await ctx.replyWithDocument(new InputFile(buf, file.name));
    } catch (e) {
      await ctx.reply(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  bot.command("start", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) {
      await ctx.reply("⛔ Not authorized. Add your chat ID to TELEGRAM_CHAT_IDS.");
      return;
    }
    await ctx.reply(
      "🔗 *Claudemesh Telegram Bridge*\n\n" +
      "Commands:\n" +
      "• /peers — List online peers\n" +
      "• /dm <name> <msg> — DM a specific peer\n" +
      "• /broadcast <msg> — Message all peers\n" +
      "• /group @name <msg> — Message a group\n" +
      "• /file <id> — Download a mesh file\n" +
      "• /status — Bridge connection status\n\n" +
      "Send a photo/document to share it with the mesh.\n" +
      "Or just type a message to broadcast it.",
      { parse_mode: "Markdown" },
    );
  });

  // Handle inline keyboard callbacks for peer selection
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

    if (data === "dm:all") {
      // Send to all matches
      let sent = 0;
      for (const p of pending.matches) {
        const ok = await defaultBridge.sendMessage(p.pubkey, `[via Telegram] ${pending.message}`, "now");
        if (ok) sent++;
      }
      pendingDMs.delete(chatId);
      await ctx.answerCallbackQuery({ text: `Sent to ${sent} peers` });
      await ctx.editMessageText(`✅ Sent to all ${sent} ${pending.matches[0]?.displayName ?? "?"} peers`);
      return;
    }

    // Single selection: dm:0, dm:1, etc.
    const idx = parseInt(data.slice(3));
    const peer = pending.matches[idx];
    if (!peer) {
      await ctx.answerCallbackQuery({ text: "Invalid selection" });
      return;
    }

    const ok = await defaultBridge.sendMessage(peer.pubkey, `[via Telegram] ${pending.message}`, "now");
    pendingDMs.delete(chatId);
    const dir = peer.cwd?.split("/").pop() ?? "?";
    await ctx.answerCallbackQuery({ text: ok ? "Sent!" : "Failed" });
    await ctx.editMessageText(ok ? `✅ → ${peer.avatar ?? "🤖"} ${peer.displayName} (${dir})` : "❌ Not connected");
  });

  // Handle photos from Telegram → share to mesh
  bot.on("message:photo", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const photo = ctx.message.photo.at(-1); // highest resolution
    if (!photo) return;
    try {
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(url);
      const buf = Buffer.from(await resp.arrayBuffer());
      const name = `telegram-photo-${Date.now()}.jpg`;
      const fileId = await defaultBridge.uploadFile(buf, name, ["telegram", "photo"]);
      if (fileId) {
        const caption = ctx.message.caption ? ` — "${ctx.message.caption}"` : "";
        await defaultBridge.sendMessage("*", `[via Telegram] 📷 Photo shared${caption} (file: ${fileId})`, "next");
        await ctx.reply(`✅ Photo shared to mesh (${fileId})`);
      } else {
        await ctx.reply("❌ Upload failed");
      }
    } catch (e) {
      await ctx.reply(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // Handle documents from Telegram → share to mesh
  bot.on("message:document", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const doc = ctx.message.document;
    if (!doc) return;
    try {
      const file = await ctx.api.getFile(doc.file_id);
      const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(url);
      const buf = Buffer.from(await resp.arrayBuffer());
      const name = doc.file_name ?? `telegram-file-${Date.now()}`;
      const fileId = await defaultBridge.uploadFile(buf, name, ["telegram", "document"]);
      if (fileId) {
        const caption = ctx.message.caption ? ` — "${ctx.message.caption}"` : "";
        await defaultBridge.sendMessage("*", `[via Telegram] 📎 File shared: ${name}${caption} (file: ${fileId})`, "next");
        await ctx.reply(`✅ File shared to mesh: ${name} (${fileId})`);
      } else {
        await ctx.reply("❌ Upload failed");
      }
    } catch (e) {
      await ctx.reply(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // Default: any text without a command → broadcast
  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // Skip unknown commands

    // Check for @mention pattern: "@PeerName message"
    const mentionMatch = text.match(/^@(\S+)\s+([\s\S]+)$/);
    if (mentionMatch) {
      const target = mentionMatch[1]!;
      const message = mentionMatch[2]!;
      const matches = await defaultBridge.findPeersByName(target);
      if (matches.length === 0) {
        await ctx.reply(`❌ No peer named "${target}"`);
      } else if (matches.length === 1) {
        const ok = await defaultBridge.sendMessage(matches[0]!.pubkey, `[via Telegram] ${message}`, "now");
        await ctx.reply(ok ? `✅ → ${matches[0]!.avatar ?? "🤖"} ${matches[0]!.displayName}` : "❌ Not connected");
      } else {
        pendingDMs.set(ctx.chat.id, { message, matches, selected: new Set() });
        const buttons = matches.map((p, i) => {
          const dir = p.cwd?.split("/").pop() ?? "?";
          return [{ text: `${p.avatar ?? "🤖"} ${p.displayName} (${dir})`, callback_data: `dm:${i}` }];
        });
        buttons.push([{ text: "📨 Send to ALL", callback_data: "dm:all" }]);
        await ctx.reply(`Multiple "${target}" peers. Pick one or all:`, {
          reply_markup: { inline_keyboard: buttons },
        });
      }
      return;
    }

    // No mention → broadcast
    const ok = await defaultBridge.sendMessage("*", `[via Telegram] ${text}`, "next");
    if (!ok) await ctx.reply("❌ Not connected to mesh");
  });

  function isAllowed(chatId: number): boolean {
    // If no chat IDs configured, allow all (dev mode)
    if (ALLOWED_CHAT_IDS.length === 0) return true;
    return ALLOWED_CHAT_IDS.includes(chatId);
  }

  // Start bot
  console.log("[tg] starting bot...");
  bot.start({
    onStart: () => console.log("[tg] bot running"),
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("[shutdown] closing...");
    bot.stop();
    bridges.forEach(b => b.close());
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("[shutdown] closing...");
    bot.stop();
    bridges.forEach(b => b.close());
    process.exit(0);
  });
}

main().catch(e => {
  console.error("fatal:", e);
  process.exit(1);
});
