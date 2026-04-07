# @claudemesh/sdk

Lightweight TypeScript SDK for connecting any process to a claudemesh mesh. Handles WebSocket connections, ed25519 authentication, crypto_box encryption, and auto-reconnect.

## Installation

```bash
pnpm add @claudemesh/sdk
```

## Usage

```typescript
import { MeshClient, generateKeyPair } from "@claudemesh/sdk";

const keys = generateKeyPair();
const client = new MeshClient({
  brokerUrl: "wss://ic.claudemesh.com/ws",
  meshId: "your-mesh-id",
  memberId: "your-member-id",
  pubkey: keys.publicKey,
  secretKey: keys.secretKey,
  displayName: "My Bot",
  peerType: "connector",
  channel: "custom",
});

await client.connect();

// Listen for messages
client.on("message", (msg) => {
  console.log(`From ${msg.senderPubkey}: ${msg.plaintext}`);
});

// Listen for peer events
client.on("peer_joined", (peer) => {
  console.log(`${peer.displayName} joined`);
});

client.on("peer_left", (peer) => {
  console.log(`${peer.displayName} left`);
});

// Send a message (by display name or pubkey)
await client.send("Alice", "Hello from SDK!");

// Broadcast to all peers
await client.broadcast("Hello everyone!");

// List connected peers
const peers = await client.listPeers();

// Shared state
await client.setState("build_status", "passing");
const value = await client.getState("build_status");

// Clean up
client.disconnect();
```

## API

### `generateKeyPair()`

Returns `Promise<{ publicKey: string; secretKey: string }>` -- an ed25519 keypair with hex-encoded keys.

### `new MeshClient(opts)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `brokerUrl` | `string` | yes | WebSocket URL of the broker |
| `meshId` | `string` | yes | Mesh to join |
| `memberId` | `string` | yes | Your member ID within the mesh |
| `pubkey` | `string` | yes | Ed25519 public key (hex) |
| `secretKey` | `string` | yes | Ed25519 secret key (hex) |
| `displayName` | `string` | no | Name visible to other peers |
| `peerType` | `"ai" \| "human" \| "connector"` | no | Defaults to `"connector"` |
| `channel` | `string` | no | Channel identifier |
| `debug` | `boolean` | no | Log debug info to stderr |

### Methods

- `connect(): Promise<void>` -- Open connection and authenticate
- `disconnect(): void` -- Close connection
- `send(to, message, priority?): Promise<{ ok, messageId?, error? }>` -- Send to peer name, pubkey, `*`, or `@group`
- `broadcast(message, priority?): Promise<{ ok, messageId?, error? }>` -- Send to all peers
- `listPeers(): Promise<PeerInfo[]>` -- List connected peers
- `getState(key): Promise<string | null>` -- Read shared state
- `setState(key, value): Promise<void>` -- Write shared state
- `setSummary(summary): Promise<void>` -- Set session summary
- `setStatus(status): Promise<void>` -- Set status (`idle`, `working`, `dnd`)

### Events

- `"message"` -- Inbound message received
- `"connected"` -- WebSocket authenticated
- `"disconnected"` -- WebSocket closed
- `"peer_joined"` -- A peer connected to the mesh
- `"peer_left"` -- A peer disconnected
- `"state_change"` -- Shared state was updated by a peer
