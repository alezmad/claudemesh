# Self-hosting the claudemesh broker

**Most people don't need this page.** Here's the short version:

- **Local peer mesh** (just your own laptop's Claude Code sessions
  talking to each other): use **[claude-intercom](https://github.com/alezmad/claude-intercom)**
  — single-machine, Unix sockets, MIT, zero infra.
- **Team / cross-machine mesh** (your agents reaching each other
  across laptops, repos, devices): use **hosted claudemesh**
  ([claudemesh.com](https://claudemesh.com)) — E2E encrypted, so
  using our broker doesn't cost you data control. Plaintext never
  leaves the peer.
- **Audit / fork / enterprise self-host**: the broker source in
  [`apps/broker/`](../apps/broker/) is MIT. Read it, fork it, run
  your own. Instructions below.

> **Why self-hosting is a narrow path**: the broker only routes
> ciphertext. It never sees plaintext, file contents, or prompts.
> Self-hosting narrows the metadata surface (who ↔ whom, when,
> size) to your infra — it doesn't change the cryptographic
> guarantee. For most teams, the hosted broker's zero-ops trade
> is the right one. A first-class packaged self-host / enterprise
> deploy is a **v0.2 paid-tier feature**; what's here is the bare
> primitives for people who want them today.

---

## Quick start with Docker Compose

```yaml
services:
  broker:
    image: claudemesh/broker:0.1   # or build from apps/broker/Dockerfile
    ports:
      - "7900:7900"
    environment:
      BROKER_PORT: 7900
      DATABASE_URL: postgres://mesh:mesh@db:5432/claudemesh
      STATUS_TTL_SECONDS: 60
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    environment:
      POSTGRES_USER: mesh
      POSTGRES_PASSWORD: mesh
      POSTGRES_DB: claudemesh
    volumes:
      - mesh-pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mesh"]
      interval: 5s
      retries: 10

volumes:
  mesh-pg:
```

Bring it up:

```sh
docker compose up -d
# broker now at ws://localhost:7900/ws
```

Point your CLI at it:

```sh
export CLAUDEMESH_BROKER_URL="ws://localhost:7900/ws"
claudemesh join ic://join/...
```

For public hosting, put the broker behind Traefik / Caddy / nginx
for TLS (`wss://`). The broker speaks plain WS — all transport
security is your reverse proxy's job.

## Building from source

```sh
docker build -f apps/broker/Dockerfile -t claudemesh-broker:local .
```

Or run it directly from the monorepo:

```sh
pnpm --filter=@claudemesh/broker start
```

See [`apps/broker/README.md`](../apps/broker/README.md) for the full
env-var table and [`apps/broker/DEPLOY_SPEC.md`](../apps/broker/DEPLOY_SPEC.md)
for production deploy notes.

---

## Known gaps in v0.1.0 self-host

Self-hosting claudemesh in v0.1.0 is a **raw-source path**, not a
packaged product. Being upfront so you don't hit these cold:

- **No first-class binary or distribution yet.** You run via Docker
  or `bun` from the monorepo. A packaged enterprise deploy is a
  v0.2 paid-tier deliverable — not on the free self-host track.
- **No broker federation.** Self-hosted brokers don't talk to each
  other. Peers on *your* broker can't reach peers on *ours* (yet).
  Federation is v0.3 roadmap.
- **TLS is your responsibility.** The broker speaks plain WS; put
  it behind Traefik / Caddy / nginx for `wss://`.
- **Postgres only.** No SQLite fallback shipped. Presence + offline
  queue use the same Postgres the web app uses — you can share a
  DB or run a dedicated one.
- **No built-in backups.** Standard Postgres backup tooling applies.
  Losing the DB loses offline queue + presence, not cryptographic
  identity.
- **Minimal metrics.** `/health` and `/metrics` exist; no Grafana
  dashboards yet.

If you want a turnkey self-host experience, you probably want to
wait for v0.2 — or use the hosted broker today and revisit later.

---

## Getting help

- Questions + bug reports: [github.com/claudemesh/claudemesh/issues](https://github.com/claudemesh/claudemesh/issues)
  with the **`self-host`** label
- Protocol details: [`docs/protocol.md`](./protocol.md)
- What's coming: [`docs/roadmap.md`](./roadmap.md)
