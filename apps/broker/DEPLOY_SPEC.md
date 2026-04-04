# @claudemesh/broker — Deployment Spec

Runtime contract for deploying the broker. Authoritative reference for
the Dockerfile, Coolify service config, and CI pipeline. Owned by the
broker lane; consumed by the deploy lane.

## Runtime

- **Entry point**: `bun apps/broker/src/index.ts` (TypeScript executed
  directly by Bun, no compile step).
- **Single process**. Stateless — all persistence is in Postgres.
- **Single port**: HTTP + WebSocket multiplexed over one TCP port.
  WS upgrades match path `/ws`; all other requests route to HTTP.

## Routes

| Path                | Method     | Purpose                                         |
| ------------------- | ---------- | ----------------------------------------------- |
| `/ws`               | GET/UPGRADE| Authenticated peer connections (WebSocket)      |
| `/hook/set-status`  | POST       | Claude Code hook scripts report peer status     |
| `/health`           | GET        | Liveness + build info. 503 if Postgres is down. |
| `/metrics`          | GET        | Prometheus plaintext metrics                    |

## Environment variables

### Required

| Var            | Format                                    | Notes                        |
| -------------- | ----------------------------------------- | ---------------------------- |
| `DATABASE_URL` | `postgres://user:pass@host:port/db`       | Must use postgres:// scheme  |

### Optional (with defaults)

| Var                         | Default | Range              | Purpose                                              |
| --------------------------- | ------- | ------------------ | ---------------------------------------------------- |
| `BROKER_PORT`               | `7900`  | any free port      | Single port for HTTP + WS                            |
| `STATUS_TTL_SECONDS`        | `60`    | > 0                | Flip stuck "working" peers to idle after this TTL    |
| `HOOK_FRESH_WINDOW_SECONDS` | `30`    | > 0                | Window during which a hook signal beats JSONL infer  |
| `MAX_CONNECTIONS_PER_MESH`  | `100`   | > 0                | Refuse new WS at capacity with close code 1008       |
| `MAX_MESSAGE_BYTES`         | `65536` | > 0                | Max WS payload and hook POST body size               |
| `HOOK_RATE_LIMIT_PER_MIN`   | `30`    | > 0                | Per-(pid,cwd) token bucket on /hook/set-status       |
| `NODE_ENV`                  | `development` | dev/prod/test | Standard                                            |
| `GIT_SHA`                   | —       | hex string         | Preferred over `git rev-parse` fallback, for image builds |

No secrets baked into the image — everything via env at runtime.

## Healthcheck

Container healthcheck SHOULD hit `/health`:

```dockerfile
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:7900/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

`/health` returns `200` with:
```json
{
  "status": "ok",
  "db": "up",
  "version": "0.1.0",
  "gitSha": "84e14ff",
  "uptime": 123
}
```

Returns `503` when Postgres is unreachable (`"status":"degraded","db":"down"`).
The broker does NOT exit on transient DB failures — it keeps serving
and recovers automatically when the DB comes back.

## Signals

- `SIGTERM` and `SIGINT` → graceful shutdown:
  1. Stop background sweepers (TTL, pending-status, DB ping).
  2. Close all WS connections with code `1001`.
  3. Mark all active presences as `disconnectedAt=now` in Postgres.
  4. Close HTTP server.
  5. Exit 0.

Grace period: ~5s typical. Orchestrators should allow ≥10s before
sending SIGKILL.

## Image

- **Base**: `oven/bun:1.2-slim` for runtime (Bun executes TS directly).
  pnpm-install stage can use a separate `node:22-slim` image.
- **User**: non-root. `oven/bun` ships with UID 1000 `bun` user.
- **Target size**: <200MB compressed.
- **Volumes**: none. Broker is stateless.

### Build stages (recommended)

1. **deps**: Node + pnpm + full workspace → `pnpm install --frozen-lockfile --ignore-scripts`
2. **runtime**: Bun + copy node_modules + copy only needed workspace packages:
   - `apps/broker/`
   - `packages/db/`
   - `packages/shared/`
   - `tooling/typescript/`
   - root metadata (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`)

### Build args

- `GIT_SHA` SHOULD be passed at build time and forwarded as ENV so
  `/health` surfaces the image commit:
  ```dockerfile
  ARG GIT_SHA
  ENV GIT_SHA=$GIT_SHA
  ```
  CI should set `--build-arg GIT_SHA=${GITHUB_SHA:0:7}` (or equivalent).

## Dependencies

Runtime needs reachable:
- **Postgres 15+** with `pgvector` extension enabled (the broker itself
  doesn't use vector, but shared migrations do — if you deploy the
  broker-only migration subset you can drop pgvector).
- No other external services. No Redis, no queue, no cache.

## Deployment targets (authoritative lane)

- **Production**: OVH VPS via Coolify, Traefik-fronted. Internal port
  7900 → Traefik → `ic.claudemesh.com:443`. Separate deploy lane owns
  Traefik labels, TLS, DNS, compose.
- **Test DB on CI**: spin up pgvector/pgvector:pg17, create
  `claudemesh_test` database, run migrations, then `pnpm test` in
  `apps/broker`. See below.

## CI integration

Test suite requires a live Postgres. Suggested GitHub Actions step:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    env:
      POSTGRES_USER: turbostarter
      POSTGRES_PASSWORD: turbostarter
      POSTGRES_DB: claudemesh_test
    ports: ['5440:5432']
    options: >-
      --health-cmd="pg_isready -U turbostarter"
      --health-interval=5s

steps:
  - uses: actions/checkout@v4
  - run: pnpm install --frozen-lockfile
  - run: cd packages/db && pnpm exec drizzle-kit migrate
    env: { DATABASE_URL: 'postgresql://turbostarter:turbostarter@127.0.0.1:5440/claudemesh_test' }
  - run: cd apps/broker && pnpm test
    env: { DATABASE_URL: 'postgresql://turbostarter:turbostarter@127.0.0.1:5440/claudemesh_test' }
```

## Metrics

Scraped by Prometheus via `GET /metrics`. Key series:

- `broker_connections_active` (gauge)
- `broker_connections_total` (counter)
- `broker_connections_rejected_total{reason}` (counter: capacity, unauthorized)
- `broker_messages_routed_total{priority}` (counter: now, next, low)
- `broker_messages_rejected_total{reason}` (counter)
- `broker_queue_depth` (gauge — undelivered messages)
- `broker_ttl_sweeps_total{flipped}` (counter)
- `broker_hook_requests_total` (counter)
- `broker_hook_requests_rate_limited_total` (counter)
- `broker_db_healthy` (gauge: 0 or 1)

Alert recommendations:
- `broker_db_healthy == 0` for > 60s → page oncall
- `broker_queue_depth > 10000` → investigate
- `broker_connections_rejected_total{reason="capacity"}` rising → scale

## Logs

Structured JSON, one line per event, stderr. No log aggregation
required — suitable for stdout/stderr capture and direct ingestion
into Loki/Datadog/CloudWatch without parsing.

Key events: `broker listening`, `ws hello`, `ws close`, `ws set_status`,
`hook` (with `cwd`, `pid`, `status`, `presence_id`, `pending`), `shutdown signal`,
`shutdown complete`, `db healthy`, `db ping failed`.
