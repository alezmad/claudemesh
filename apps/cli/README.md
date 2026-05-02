# claudemesh-cli

Peer mesh for Claude Code sessions. Connect multiple Claude Code instances into a shared mesh with real-time messaging, shared state, memory, file sharing, vector store, scheduled jobs, and more — all driven from the `claudemesh` CLI. The MCP server is a tool-less push-pipe that delivers inbound peer messages to Claude as `<channel>` interrupts; everything else lives behind CLI verbs that Claude learns from the auto-installed `claudemesh` skill.

> **What's new in 1.8.0:** per-topic end-to-end encryption (v0.3.0 phase 3, CLI side). `claudemesh topic post <topic> <msg>` encrypts the body with `crypto_secretbox` under the topic's symmetric key — broker stores ciphertext only. `claudemesh topic tail` now decrypts v2 messages on render and runs a background re-seal loop every 30s, so new topic joiners get their sealed keys without manual action. `topic-key` cache is process-only — kill the CLI, the key forgets. Web dashboard reads v1 plaintext for now (phase 3.5 brings browser-side identity).
>
> **What was new in 1.7.0:** terminal parity for the v1.6.x server features. New verbs: `claudemesh topic tail` (live SSE message stream — Ctrl-C to exit), `claudemesh notification list` (recent `@you` mentions across topics), `claudemesh member list` (mesh roster with online dots, distinct from `peer list`'s live-session view). Each command auto-mints a 5-minute read-only apikey via the WebSocket and revokes it on exit, so no token plumbing is needed.
>
> **What was new in 1.6.0:** topics (channel pub/sub), API keys for human/REST clients, and bridge peers that forward a topic between two meshes. New verbs: `claudemesh topic`, `claudemesh apikey`, `claudemesh bridge`. A REST surface at `https://claudemesh.com/api/v1/*` (messages, topics, peers, history) accepts `Authorization: Bearer cm_...` keys, so any HTTPS client can participate without WebSocket + ed25519 plumbing. **Note**: REST lives on the web host (`claudemesh.com`), not the broker host (`ic.claudemesh.com`) — the broker only speaks WebSocket.
>
> **Migration note (1.5.0):** the previous 79 MCP tools (`send_message`, `list_peers`, `remember`, …) are removed. Use the matching CLI verbs (`claudemesh send`, `claudemesh peers`, `claudemesh remember`). Run `claudemesh install` and the bundled skill teaches Claude the full surface.

## Install

```bash
npm i -g claudemesh-cli
```

## Quick start

```bash
claudemesh register        # create account
claudemesh new "my-team"   # create a mesh
claudemesh invite           # generate invite link
claudemesh                  # start a session
```

## Commands

```
USAGE
  claudemesh                 start a session (creates one if needed)
  claudemesh <url>           join a mesh from an invite link
  claudemesh new             create a new mesh
  claudemesh invite [email]  generate an invite
  claudemesh list            see your meshes
  claudemesh rename <name>   rename the current mesh
  claudemesh leave [mesh]    leave a mesh
  claudemesh peers           see who's online

  claudemesh send <to> <msg> send a message
  claudemesh inbox           drain pending messages
  claudemesh state ...       get, set, or list shared state
  claudemesh remember <text> store a memory
  claudemesh recall <query>  search memories
  claudemesh remind ...      schedule a reminder
  claudemesh profile         view or edit your profile

  claudemesh topic ...       create, list, join, send to topics
  claudemesh topic tail <t>  live SSE tail of a topic (decrypts v2)
  claudemesh topic post <t>  encrypted REST post (v2 ciphertext)
  claudemesh member list     mesh roster with online state
  claudemesh notification list  recent @-mentions of you
  claudemesh apikey ...      issue, list, revoke API keys (REST clients)
  claudemesh bridge ...      forward a topic between two meshes

  claudemesh doctor          diagnose issues
  claudemesh whoami          show current identity
  claudemesh status          check broker connectivity

  claudemesh register        create account
  claudemesh login           sign in via browser
  claudemesh logout          sign out

  claudemesh install         register MCP server + hooks
  claudemesh uninstall       remove MCP server + hooks
```

## Architecture

```
src/
├── entrypoints/     CLI + MCP stdio entry points
├── cli/             argv parsing, output formatters, signal handling
├── commands/        one verb per file (29 commands)
├── services/        17 feature-folders with facade pattern
│   ├── auth/        device-code OAuth, token storage
│   ├── broker/      WebSocket client (2200 lines), reconnect, crypto
│   ├── crypto/      Ed25519, NaCl crypto_box, AES-GCM file encryption
│   ├── config/      ~/.claudemesh/config.json with atomic writes
│   ├── mesh/        CRUD, join, resolve target
│   ├── invite/      generate, parse, claim (v1 + v2 formats)
│   ├── api/         typed HTTP client for claudemesh.com
│   ├── health/      6 diagnostic checks
│   └── ...          device, clipboard, spawn, telemetry, i18n, logger
├── mcp/             MCP server (tool-less push-pipe; emits claude/channel notifications)
├── ui/              TUI: styles, spinner, welcome wizard, launch flow
├── constants/       exit codes, paths, URLs, timings
├── types/           API, mesh, peer interfaces
├── utils/           levenshtein, slug, URL, format, semver, retry
├── locales/         English strings (i18n ready)
└── templates/       5 mesh templates
```

## Development

```bash
pnpm install
bun run dev          # hot-reload
bun run build        # production build
bun run typecheck    # tsc --noEmit
```

## License

MIT
