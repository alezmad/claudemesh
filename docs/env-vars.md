# claudemesh environment variables

Reference for every env var the broker and CLI read.

## Broker (`apps/broker`)

### Required in production

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Must reach the `mesh` schema. |
| `BROKER_ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256-GCM at-rest encryption of MCP env vars. **Broker refuses to start in production if missing or malformed.** Never log the value. Generate with `openssl rand -hex 32`. |

### Optional

| Var | Default | Purpose |
|---|---|---|
| `BROKER_PORT` | `7900` | HTTP/WS listen port. |
| `BROKER_PUBLIC_URL` | `https://ic.claudemesh.com` | Public base for webhook URL generation and similar. |
| `BROKER_WS_URL` | `wss://ic.claudemesh.com/ws` | Public WS URL announced to integrations (Telegram bridge). |
| `APP_URL` | `https://claudemesh.com` | Web-app base for invite short URLs (`/i/<code>`). |
| `EMAIL_FROM` | `noreply@claudemesh.com` | Sender address for Postmark invite emails. |
| `POSTMARK_API_KEY` | — | Postmark server token. Set this or RESEND_API_KEY to enable email invites. |
| `RESEND_API_KEY` | — | Resend API key (alternative to Postmark). |
| `MAX_MESSAGE_BYTES` | `65536` | Hard cap on nonce+ciphertext+targetSpec in a send. |
| `MAX_CONNECTIONS_PER_MESH` | varies | Per-mesh connection cap. |
| `STATUS_TTL_SECONDS` | `60` | How long a presence can stay "working" before being swept back to idle. |
| `HOOK_RATE_LIMIT_PER_MIN` | — | TokenBucket refill rate for `/hook/set-status`. |
| `HOOK_FRESH_WINDOW_SECONDS` | — | How long a hook-set status takes precedence over the JSONL fallback. |
| `MAX_SERVICES_PER_MESH` | varies | Cap on deployed MCP services per mesh. |
| `BROKER_INVITE_V2_ENABLED` | unset (disabled) | Flip to `1` to accept POST /invites/:code/claim. **Broken until the ed25519 binding step lands — see `.artifacts/specs/2026-04-15-invite-v2-cli-migration.md`.** |
| `BROKER_LEGACY_AUTH` | unset (disabled) | Flip to `1` to accept pre-alpha.36 CLIs that send `user_id` in body instead of Bearer. Metered via `broker_legacy_auth_hits_total`; target removal once hits reach ~0. |
| `EXPECTED_MIGRATION` | unset | SHA of the newest applied migration to require on `GET /health/ready`. If set and the DB doesn't contain it, readiness fails → Coolify will not promote the deploy. |
| `NODE_ENV` | — | Setting to `production` enables fail-fast on missing `BROKER_ENCRYPTION_KEY`. |

## CLI (`apps/cli`)

| Var | Default | Purpose |
|---|---|---|
| `CLAUDEMESH_BROKER_URL` | `wss://ic.claudemesh.com/ws` | Override the broker WS URL (self-hosters, tests). |
| `CLAUDEMESH_API_URL` | `https://claudemesh.com` | Override the API base URL. |
| `CLAUDEMESH_BROKER_HTTP` | derived from `CLAUDEMESH_BROKER_URL` | Explicit HTTPS base used by `claimInviteV2` — overrides the derivation rule. |
| `CLAUDEMESH_CLAIM_URL` | derived | Explicit URL template for the v2 claim endpoint. `{code}` is substituted. |
| `CLAUDEMESH_CONFIG_DIR` | `~/.claudemesh` | Where `config.json`, `auth.json`, `grants.json`, `peer-cache.json` live. |
| `CLAUDEMESH_DEBUG` | `0` | Flip to `1` to see `[claudemesh]` stderr lines from MCP + WS client. |
| `CLAUDEMESH_DISPLAY_NAME` | hostname | Override for display_name in hello. |
| `CLAUDEMESH_INVITE_V2` | unset | Flip to `1` to prefer the v2 invite claim flow (CLI-side gated — spec pending). |

## `/install` shell script (`apps/web/src/app/install/route.ts`)

| Var | Purpose |
|---|---|
| `CLAUDEMESH_DIR` | Installer target dir. Defaults to `$HOME/.claudemesh`. |
| `CLAUDEMESH_BIN` | Shim dir. Defaults to `$HOME/.local/bin`. |

## Secrets that should NEVER be logged

- `BROKER_ENCRYPTION_KEY` — AES key; leaking it voids encryption-at-rest
- `POSTMARK_API_KEY`, `RESEND_API_KEY` — email provider tokens
- `auth.session_token` (CLI side) — bearer for all broker calls
- `mesh.owner_secret_key` (broker side) — invite signing key
- `mesh.root_key` (broker side) — symmetric mesh key
