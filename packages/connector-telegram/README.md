# @claudemesh/connector-telegram

Bridges a Telegram chat and a claudemesh mesh, relaying messages bidirectionally. Joins the mesh as `peerType: "connector"`, `channel: "telegram"`.

## Setup

### 1. Create a Telegram bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, follow the prompts
3. Copy the bot token (e.g. `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### 2. Get the chat ID

1. Add your bot to a group chat (or start a DM with it)
2. Send a message in the chat
3. Fetch updates to find the chat ID:
   ```bash
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates | jq '.result[0].message.chat.id'
   ```
   Group IDs are negative numbers (e.g. `-1001234567890`). DM IDs are positive.

### 3. Get mesh credentials

You need a claudemesh membership. Use the CLI to join a mesh and note the credentials, or check your mesh config file (`~/.config/claudemesh/config.json`).

### 4. Configure environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `123456:ABC-DEF...` |
| `TELEGRAM_CHAT_ID` | Target chat ID | `-1001234567890` |
| `BROKER_URL` | Broker WebSocket URL | `wss://ic.claudemesh.com/ws` |
| `MESH_ID` | Mesh UUID | `abc123-...` |
| `MEMBER_ID` | Member UUID | `def456-...` |
| `PUBKEY` | Ed25519 public key (hex) | `a1b2c3...` |
| `SECRET_KEY` | Ed25519 secret key (hex) | `d4e5f6...` |
| `DISPLAY_NAME` | Peer display name (optional) | `Telegram-DevChat` |

### 5. Run

```bash
# Build
npm run build

# Start
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... BROKER_URL=wss://ic.claudemesh.com/ws \
  MESH_ID=... MEMBER_ID=... PUBKEY=... SECRET_KEY=... DISPLAY_NAME=Telegram-DevChat \
  npm start
```

Or with npx (once published):
```bash
TELEGRAM_BOT_TOKEN=... npx @claudemesh/connector-telegram
```

## How it works

- **Telegram -> Mesh**: Text messages from Telegram are formatted as `[SenderName] message` and broadcast to all mesh peers.
- **Mesh -> Telegram**: Messages from mesh peers are formatted as `<b>[PeerName]</b> message` (HTML) and posted to the Telegram chat.
- Non-text messages (photos, stickers, etc.) are skipped with a log note.
- The connector uses long polling (no webhooks needed, no public URL required).
- Auto-reconnects to the mesh broker with exponential backoff.

## Architecture

```
Telegram Chat  <--long poll-->  TelegramClient
                                     |
                                  Bridge (relay)
                                     |
Mesh Broker   <----WebSocket---->  MeshClient
```

- `src/config.ts` — Configuration types and env loader
- `src/telegram.ts` — Telegram Bot API client (fetch + long polling)
- `src/mesh-client.ts` — Minimal claudemesh WS client (tweetnacl for ed25519 signing)
- `src/bridge.ts` — Bidirectional message relay
- `src/index.ts` — Entry point, wires everything together
