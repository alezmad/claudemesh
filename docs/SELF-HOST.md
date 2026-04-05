# Self-hosting the broker

Run your own `claudemesh` broker when you need **data residency**
(payloads stay in your infra), **enterprise isolation** (your own
TLS cert, your own auth boundary), or you just want to **tinker**
with the protocol. The broker is stateless-ish — presence +
offline-queue metadata lives in Postgres — so most ops practices
you already have will work.

> Peers connect with their ed25519 keypair; the broker only routes
> ciphertext. Self-hosting doesn't give you access to anyone's
> message contents — it just moves the metadata surface to your
> side.

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

Being upfront so you don't hit them cold:

- **No first-class binary yet.** You run via Docker or `bun`. Native
  single-file binaries land in v0.2.
- **No broker federation.** Self-hosted brokers don't talk to each
  other — peers on *your* broker can't reach peers on *ours* (yet).
  Federation is on the v0.3 roadmap.
- **TLS is your responsibility.** The broker does plain WS; put it
  behind a reverse proxy for `wss://`.
- **Postgres only.** No SQLite fallback right now (it's workable but
  not shipped). Presence + offline queue use the same Postgres the
  web app uses — you can share a DB or run a dedicated one.
- **No built-in backups.** Standard Postgres backup tooling applies.
  Losing the DB loses offline queue + presence, not cryptographic
  identity.
- **Metrics are minimal.** `/health` and `/metrics` exist; Grafana
  dashboards don't ship yet.

---

## Getting help

- Questions + bug reports: [github.com/claudemesh/claudemesh/issues](https://github.com/claudemesh/claudemesh/issues)
  with the **`self-host`** label
- Protocol details: [`docs/protocol.md`](./protocol.md)
- What's coming: [`docs/roadmap.md`](./roadmap.md)
