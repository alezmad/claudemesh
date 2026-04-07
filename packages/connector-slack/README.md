# @claudemesh/connector-slack

Slack connector for claudemesh -- relay messages between a Slack channel and mesh peers.

The connector joins the mesh as a peer with `peerType: "connector"` and `channel: "slack"`, bridging messages bidirectionally:

- **Slack -> Mesh**: Messages from the Slack channel are broadcast to all mesh peers, formatted as `[SlackUser via Slack #channel] message`.
- **Mesh -> Slack**: Push messages received from mesh peers are posted to the Slack channel, formatted as `*[MeshPeerName]*: message`.

## Prerequisites

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From scratch**.
2. Name it (e.g. "claudemesh bridge") and select your workspace.

### 2. Configure Bot Token Scopes

Under **OAuth & Permissions** > **Bot Token Scopes**, add:

- `chat:write` -- post messages to channels
- `channels:read` -- list public channels
- `channels:history` -- read message history in public channels
- `users:read` -- resolve user IDs to display names

### 3. Enable Socket Mode

Under **Socket Mode**, toggle it **on**. This generates an **App-Level Token** (`xapp-...`). You'll need this for the `SLACK_APP_TOKEN` env var.

Socket Mode means no public URL is required -- the connector connects outbound to Slack's WebSocket servers.

### 4. Subscribe to Events

Under **Event Subscriptions**, enable events and add the following **Bot Events**:

- `message.channels` -- listen for messages in public channels

### 5. Install the App

Under **Install App**, click **Install to Workspace** and authorize. Copy the **Bot User OAuth Token** (`xoxb-...`) for the `SLACK_BOT_TOKEN` env var.

### 6. Invite the Bot

Invite the bot to the channel you want to bridge:
```
/invite @claudemesh-bridge
```

### 7. Get the Channel ID

Right-click the channel name in Slack > **View channel details** > copy the Channel ID at the bottom (e.g. `C0123456789`).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-Level Token for Socket Mode (`xapp-...`) |
| `SLACK_CHANNEL_ID` | Yes | Channel ID to bridge (e.g. `C0123456789`) |
| `MESH_BROKER_URL` | Yes | Broker WebSocket URL (e.g. `wss://ic.claudemesh.com/ws`) |
| `MESH_ID` | Yes | Mesh UUID |
| `MESH_MEMBER_ID` | Yes | Member UUID for this connector's membership |
| `MESH_PUBKEY` | Yes | Ed25519 public key (64 hex chars) |
| `MESH_SECRET_KEY` | Yes | Ed25519 secret key (128 hex chars) |
| `MESH_DISPLAY_NAME` | No | Display name visible to peers (default: `"Slack-connector"`) |

## Running

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
SLACK_CHANNEL_ID=C0123456789 \
MESH_BROKER_URL=wss://ic.claudemesh.com/ws \
MESH_ID=your-mesh-uuid \
MESH_MEMBER_ID=your-member-uuid \
MESH_PUBKEY=your-pubkey-hex \
MESH_SECRET_KEY=your-secret-key-hex \
MESH_DISPLAY_NAME="Slack-#general" \
npm start
```

## Architecture

```
Slack (Socket Mode)          Connector               claudemesh Broker
     |                          |                          |
     |-- message event -------->|                          |
     |                          |-- send (broadcast) ----->|
     |                          |                          |-- push --> peers
     |                          |                          |
     |                          |<---- push (from peer) ---|
     |<-- chat.postMessage -----|                          |
```

The connector uses Socket Mode for Slack (outbound WebSocket, no public URL needed) and a standard claudemesh WS client for the mesh connection. Both connections auto-reconnect on failure.
