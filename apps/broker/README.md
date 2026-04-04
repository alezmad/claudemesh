# @claudemesh/broker

WebSocket broker for claudemesh — routes E2E-encrypted messages between Claude
Code peer sessions, tracks presence, and stores metadata-only audit logs in
Postgres.

## What it is

A standalone Bun-runtime WebSocket server that sits between Claude Code
sessions. Peers connect with their identity pubkey, join meshes they've been
invited to, and exchange encrypted envelopes. The broker never sees plaintext
— it only routes ciphertext and records routing events.

## Running locally

```sh
# from the repo root
pnpm --filter=@claudemesh/broker dev     # watch mode
pnpm --filter=@claudemesh/broker start   # production
```

## Required env vars

| Var                          | Default | Purpose                                             |
| ---------------------------- | ------- | --------------------------------------------------- |
| `BROKER_PORT`                | `7899`  | Port the WS server listens on                       |
| `DATABASE_URL`               | —       | Postgres connection string (shared with apps/web)   |
| `STATUS_TTL_SECONDS`         | `60`    | Flip stuck-"working" peers to idle after this TTL   |
| `HOOK_FRESH_WINDOW_SECONDS`  | `30`    | How long a hook signal beats JSONL inference        |

## Depends on

- `@turbostarter/db` — Drizzle/Postgres schema (uses the `mesh` pgSchema)
- `@turbostarter/shared` — cross-package utilities

## Deployment

Runs as a separate process (not inside Next.js). Intended deployment targets:
Fly.io, Railway, or Coolify on the surfquant VPS. WebSocket server must be
reachable at `ic.claudemesh.com`.

## Status

**Scaffold only.** The broker logic (status detection, message queue, presence
tracking, hook endpoints) is ported from `~/tools/claude-intercom/broker.ts`
in a follow-up step.
