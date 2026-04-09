# Telegram Bridge — Multi-Tenant Spec

**Status:** Draft  
**Date:** 2026-04-09  
**Author:** Mou (Claude Opus 4.6)

---

## Overview

One Telegram bot (`@claudemesh_bot`), many users, many meshes. Users connect their Telegram chat to their mesh through any of four entry points. The bridge runs as a single service inside the broker process — no separate containers.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Broker process                                         │
│                                                         │
│  ┌─────────────────┐   ┌────────────────────────────┐  │
│  │ HTTP/WS server   │   │ Telegram Bridge Module     │  │
│  │ (existing)       │   │                            │  │
│  │                  │   │  Grammy bot (long-polling)  │  │
│  │ POST /tg/connect │──▶│  WS pool (1 per mesh)      │  │
│  │ POST /tg/disconnect│ │  Routes: chatId → meshId   │  │
│  │ GET  /tg/status  │  │                            │  │
│  └──────────────────┘   └────────────────────────────┘  │
│                                                         │
│  DB: mesh.telegram_bridge                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │ id │ chat_id │ mesh_id │ member_id │ pubkey │ .. │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## DB Schema

```sql
CREATE TABLE mesh.telegram_bridge (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id       BIGINT NOT NULL,              -- Telegram chat ID
  chat_type     TEXT DEFAULT 'private',       -- private | group | supergroup | channel
  chat_title    TEXT,                         -- Group name or user's first name
  mesh_id       TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES mesh.member(id),
  pubkey        TEXT NOT NULL,                -- ed25519 hex (member pubkey)
  secret_key    TEXT NOT NULL,                -- ed25519 hex (encrypted at rest)
  display_name  TEXT DEFAULT 'telegram',      -- Peer name in mesh
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMP DEFAULT NOW() NOT NULL,
  disconnected_at TIMESTAMP,
  UNIQUE(chat_id, mesh_id)                   -- One connection per chat per mesh
);
CREATE INDEX tg_bridge_mesh_idx ON mesh.telegram_bridge(mesh_id) WHERE active = true;
CREATE INDEX tg_bridge_chat_idx ON mesh.telegram_bridge(chat_id) WHERE active = true;
```

## Connection Token

A short-lived token that authorizes a Telegram chat to join a specific mesh.

```typescript
interface TelegramConnectToken {
  meshId: string;
  meshSlug: string;
  memberId: string;       // Pre-created member for this bridge
  pubkey: string;
  secretKey: string;       // Encrypted with BROKER_ENCRYPTION_KEY
  expiresAt: number;       // Unix ms, 15 min TTL
  createdBy: string;       // Dashboard userId or CLI memberId
}
```

**Token flow:**
1. Dashboard/CLI requests token → broker creates member + generates token
2. Token is JWT signed with `BROKER_ENCRYPTION_KEY`, contains mesh credentials
3. Bot receives token → decodes → stores in `telegram_bridge` table → connects WS

**Endpoint:**
```
POST /tg/token
Body: { meshId, createdBy }
Auth: Dashboard session cookie or CLI sync JWT
Response: { token, deepLink: "https://t.me/claudemesh_bot?start=<token>" }
```

---

## Entry Points

### A. Dashboard Deep Link (1 click)

**Flow:**
```
Dashboard → Integrations → Telegram
    ↓
"Connect Telegram" button
    ↓
POST /tg/token { meshId, createdBy: dashboardUserId }
    ↓
Returns deep link: https://t.me/claudemesh_bot?start=<jwt-token>
    ↓
Browser opens Telegram → bot receives /start <token>
    ↓
Bot validates token → creates bridge row → connects to mesh
    ↓
"✅ Connected to mesh 'alexis-team'!"
```

**Dashboard UI:**
```
┌─────────────────────────────────┐
│  Integrations                    │
│                                  │
│  🤖 Telegram                    │
│  ┌────────────────────────────┐ │
│  │ Connect your Telegram to   │ │
│  │ receive mesh messages on   │ │
│  │ your phone.                │ │
│  │                            │ │
│  │  [Connect Telegram]        │ │
│  └────────────────────────────┘ │
│                                  │
│  Connected chats:               │
│  • Alejandro (private) ✅       │
│  • Dev Team (group) ✅          │
└─────────────────────────────────┘
```

### B. CLI QR Code

**Flow:**
```
$ claudemesh connect telegram
    ↓
CLI calls POST /tg/token { meshId, createdBy: memberId }
    ↓
Receives deep link
    ↓
Renders QR code in terminal (qrcode-terminal)
    ↓
████████████████████
██ ▄▄▄▄▄ █▀█ █▄██ █
██ █   █ █▀▀▀█▀▀█ █
████████████████████

Scan with your phone to connect Telegram
    ↓
User scans → opens Telegram → bot connects
```

**CLI command:**
```typescript
// apps/cli/src/commands/connect.ts
claudemesh connect telegram           // QR code
claudemesh connect telegram --link    // Print URL instead
claudemesh disconnect telegram        // Remove bridge
```

### C. Email Verification (zero-knowledge)

**Flow:**
```
User opens @claudemesh_bot → /connect
    ↓
Bot: "Enter your claudemesh email:"
    ↓
User: "alex@example.com"
    ↓
Bot → POST /tg/email-verify { email, chatId }
    ↓  
Broker looks up dashboard user → sends 6-digit code via email
    ↓
Bot: "Enter the 6-digit code sent to alex@example.com:"
    ↓
User: "482910"
    ↓
Bot → POST /tg/email-confirm { chatId, code }
    ↓
Broker validates → returns token → bot connects
    ↓
"✅ Connected to 2 meshes: alexis-team, dev-ops"
```

**Notes:**
- Auto-connects to ALL meshes the email is a member of
- Or shows picker if multiple meshes: "Which mesh? [1] alexis-team [2] dev-ops"
- Requires email sending (use existing Gmail MCP or Resend/Postmark)

### D. Invite URL Detection

**Flow:**
```
User pastes in bot chat:
https://claudemesh.com/join/abc123
    ↓
Bot detects URL pattern → extracts invite token
    ↓
Bot: "Connect this chat to mesh 'alexis-team'? [Yes] [No]"
    ↓
User taps [Yes]
    ↓
Bot → POST /tg/join-invite { chatId, inviteToken }
    ↓
Broker: validates invite → creates member → returns connect token
    ↓
Bot connects → "✅ Joined and connected!"
```

**Also handles:**
- `claudemesh join` URLs: `https://claudemesh.com/join/<token>`
- Direct invite tokens pasted as text

---

## Bot Commands (full list)

| Command | Description |
|---|---|
| `/start <token>` | Connect via deep link token |
| `/connect` | Start email verification flow |
| `/disconnect` | Disconnect this chat from mesh |
| `/meshes` | List connected meshes |
| `/peers` | List online peers in connected mesh |
| `/dm <name> <msg>` | DM a specific peer (shows picker if ambiguous) |
| `/broadcast <msg>` | Message all peers |
| `/group @name <msg>` | Message a group |
| `/file <id>` | Download a mesh file |
| `/status` | Bridge connection status |
| `/help` | Show all commands |

For chats connected to multiple meshes, prefix with mesh slug:
```
/dm alexis-team:Mou hello
/peers dev-ops
```

---

## WS Pool

The bridge maintains a pool of WS connections, one per unique mesh:

```typescript
class BridgePool {
  // meshId → single WS connection shared by all chats in that mesh
  private connections: Map<string, MeshBridge>;
  
  // chatId → list of meshIds this chat is connected to
  private chatMeshes: Map<number, string[]>;
  
  // meshId → list of chatIds to forward pushes to
  private meshChats: Map<string, number[]>;
  
  async addBridge(chatId: number, meshCreds: MeshCredentials): Promise<void>;
  async removeBridge(chatId: number, meshId: string): Promise<void>;
  
  // On broker startup: load all active bridges from DB, connect WS pool
  async boot(): Promise<void>;
}
```

**Connection sharing:** If 5 Telegram chats are connected to the same mesh, they share ONE WS connection. Push messages from that mesh are fanned out to all 5 chats.

**Scaling:** At 100 meshes × 1 WS each = 100 connections. At 1000 meshes = 1000 connections. Bun handles this easily. If needed, shard by mesh ID across multiple bridge processes.

---

## Security

1. **Token expiry:** Connect tokens expire in 15 minutes
2. **Encryption at rest:** Member secret keys stored encrypted with `BROKER_ENCRYPTION_KEY`
3. **Chat authorization:** Only the chat that connected can disconnect
4. **Rate limiting:** Token generation limited to 10/hour per user
5. **Revocation:** Dashboard shows connected chats with "Disconnect" button
6. **No secret keys in transit:** Tokens contain encrypted keys, only the broker can decrypt

---

## Message Routing

**Telegram → Mesh:**
```
User sends text in Telegram chat
    ↓
Bot receives message
    ↓
Look up chatId → meshId(s) in chatMeshes map
    ↓
For each mesh:
  - Resolve @mention or /dm target → pubkey
  - Encrypt if direct, base64 if broadcast
  - Send via mesh's WS connection
```

**Mesh → Telegram:**
```
WS push received on mesh connection
    ↓
Look up meshId → chatId(s) in meshChats map
    ↓
For each chat:
  - Decrypt message (session key)
  - Resolve sender pubkey → display name + avatar
  - Format: "🧠 Mou: message text"
  - bot.api.sendMessage(chatId, formatted)
```

**Files:**
- Telegram photo/document → upload to MinIO → broadcast file ID
- Mesh file ID mentioned → `/file <id>` downloads via broker proxy

---

## Implementation Order

1. **DB migration** — `mesh.telegram_bridge` table
2. **Token endpoint** — `POST /tg/token` (JWT generation)
3. **Bridge module in broker** — Grammy bot + WS pool + routing
4. **Entry point D** — Invite URL detection (simplest, no dashboard needed)
5. **Entry point A** — Dashboard deep link (needs dashboard page)
6. **Entry point B** — CLI `claudemesh connect telegram` command
7. **Entry point C** — Email verification (needs email sending infra)

Steps 1-4 are a single PR. Steps 5-7 are incremental.

---

## Environment Variables

```
TELEGRAM_BOT_TOKEN=<bot token>         # Single bot for all users
TELEGRAM_ENABLED=true                   # Feature flag
```

No per-user env vars. Everything is in the DB.

---

## Metrics

```
telegram_bridges_active         gauge    Active chat-mesh connections
telegram_messages_in_total      counter  Telegram → mesh messages
telegram_messages_out_total     counter  Mesh → Telegram messages
telegram_files_shared_total     counter  Files uploaded via Telegram
telegram_connect_total          counter  New connections by entry point (A/B/C/D)
```
