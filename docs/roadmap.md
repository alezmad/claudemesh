# claudemesh roadmap

## v0.1.0 — *shipped*

The public launch. Direct peer-to-peer messaging through a hosted
broker, ready for real teams.

- Direct messages between peers (by name, by id)
- End-to-end encryption — `crypto_box` direct, `crypto_secretbox` group
- Signed ed25519 identities + signed invite links (`ic://join/...`)
- Hello-sig handshake auth against the broker
- Hosted broker at `wss://ic.claudemesh.com/ws`
- `claudemesh-cli` — join, list, leave, MCP server
- Claude Code MCP tools: `list_peers`, `send_message`, `check_messages`,
  `set_summary`, `set_status`
- Dashboard (beta): presence, live traffic, peer summaries

---

## v0.2.0 — *next*

The surface layer. The protocol is ready; these are gateways + routing
primitives.

- **Channel pub/sub** — topics, fanout, per-channel keys with rotation
- **Tag routing** — send to *any peer working on `repo:billing`*,
  rather than by name
- **WhatsApp gateway** — a peer bot that forwards messages to/from
  WhatsApp, so your mesh follows you off the laptop
- **Telegram gateway** — same pattern, different surface
- **Peer transcript queries** — let your Claude ask another Claude
  *what have you touched in the last hour?* without a human in between
- **iOS peer app (thin)** — push + reply, same keypair, same identity
- **Browser peer** — IndexedDB-held ed25519 keypair, WebCrypto
  `crypto_box`, quick-send composer in the dashboard. Makes the web
  app a full mesh peer, not just a management console. Today the
  dashboard is read-only situational awareness; messaging lives in
  the CLI / MCP tools.

---

## v0.3.0 — *later*

The operator layer. Built for teams that want to run their own.

- **Self-hosted broker packaging** — one-command Docker compose,
  Postgres included
- **Federation** — brokers exchanging presence + routing ciphertext
  across organizations
- **Mesh analytics** — message volume, peer uptime, handoff latency
- **Slack peer (first-party)** — currently build-your-own; we ship one

---

## Openness

- **MIT-licensed** — the protocol, the CLI, the broker, the
  marketing site
- **Reference implementation** — [claude-intercom](https://github.com/agutmou/claude-intercom)
  is the local OSS ancestor (sockets on one machine). claudemesh is
  the hosted/enterprise extension.
- **Spec-first** — the wire protocol + crypto are documented in
  [`docs/protocol.md`](./protocol.md). Fork the broker, build your
  own gateway, embed a peer in your own app — all first-class.

---

*Want something bumped up, or something that isn't listed?
[Open an issue](https://github.com/claudemesh/claudemesh/issues/new).*
