# Deploy Guide

> Step-by-step guide for deploying this boilerplate to any VPS via Docker + Coolify.
> Designed for AI agents to follow without errors.

## Architecture

```
Build Machine (Mac/CI) → Docker Image → Registry → Coolify Service
                                                        ├── web (Next.js)
                                                        ├── db (PostgreSQL + pgvector)
                                                        └── minio (S3 storage)
```

- **Build**: Cross-compile locally (ARM Mac → AMD64 server)
- **Registry**: Gitea container registry (or any Docker registry)
- **Runtime**: Coolify manages docker-compose service
- **TLS**: Handled externally (Tailscale Funnel, Cloudflare, etc.)

## Prerequisites

- Docker Desktop with `linux/amd64` platform support
- SSH access to the target server
- Coolify running on the server
- A Docker registry (Gitea, Docker Hub, GHCR, etc.)

## Step 1: Configure Environment

```bash
# Copy the production template
cp .env.production.example .env.production

# Generate auth secret
openssl rand -base64 32
# Paste into BETTER_AUTH_SECRET=

# Fill in required values:
# - DATABASE_URL (will be set in docker-compose, but needed for schema push)
# - BETTER_AUTH_SECRET (generated above)
# - NEXT_PUBLIC_URL (your public URL)
# - BETTER_AUTH_TRUSTED_ORIGINS (same as public URL)
```

See `.env.production.example` for full list with `[REQUIRED]` / `[FEATURE]` / `[OPTIONAL]` tags.

## Step 2: Build & Push Image

```bash
# Login to your registry (adjust for your setup)
docker login <REGISTRY_HOST> -u <USERNAME>

# Build for AMD64 (required for most VPS)
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_URL=https://your-app.example.com \
  -t <REGISTRY_HOST>/<ORG>/<APP>:latest .

# Push
docker push <REGISTRY_HOST>/<ORG>/<APP>:latest
```

Build takes ~2 min on Mac M-series. If push fails with EOF, retry.

## Step 3: Create Coolify Service

Create a Coolify **service** (not application) with this docker-compose template.
Replace all `<PLACEHOLDERS>` with your values:

```yaml
services:
  web:
    image: <REGISTRY_HOST>/<ORG>/<APP>:latest
    restart: always
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOSTNAME=0.0.0.0
      - DATABASE_URL=postgres://<DB_USER>:<DB_PASS>@db:5432/<DB_NAME>
      - BETTER_AUTH_SECRET=<YOUR_SECRET>
      - BETTER_AUTH_TRUSTED_ORIGINS=https://your-app.example.com
      # Optional features — remove if not using:
      - S3_BUCKET=<BUCKET_NAME>
      - S3_REGION=us-east-1
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY_ID=<MINIO_USER>
      - S3_SECRET_ACCESS_KEY=<MINIO_PASS>
    ports:
      - "3000"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: pgvector/pgvector:pg17
    restart: always
    environment:
      POSTGRES_USER: <DB_USER>
      POSTGRES_PASSWORD: <DB_PASS>
      POSTGRES_DB: <DB_NAME>
    volumes:
      - app-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "<DB_USER>"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    restart: always
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: <MINIO_USER>
      MINIO_ROOT_PASSWORD: <MINIO_PASS>
    volumes:
      - app-minio:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio-init:
    image: minio/mc:latest
    restart: "no"
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set myminio http://minio:9000 <MINIO_USER> <MINIO_PASS>;
      mc mb myminio/<BUCKET_NAME> --ignore-existing;
      mc anonymous set download myminio/<BUCKET_NAME>;
      exit 0;
      "

volumes:
  app-postgres:
  app-minio:
```

**If you don't need S3/MinIO**: Remove `minio`, `minio-init` services and all `S3_*` env vars.

## Step 4: Set FQDN in Coolify

Set the web sub-application's FQDN. Use **HTTP** if TLS is handled externally (Tailscale, Cloudflare):

```bash
ssh <SERVER> "docker exec coolify php artisan tinker --execute=\"
use App\Models\ServiceApplication;
\\\$app = ServiceApplication::where('service_id', <SERVICE_ID>)->where('name', 'web')->first();
\\\$app->fqdn = 'http://your-app.example.com';
\\\$app->save();
echo 'FQDN: ' . \\\$app->fqdn;
\""
```

## Step 5: Start the Service

Via Coolify MCP or UI. Wait ~30 seconds for all containers to become healthy.

## Step 6: Initialize Database

```bash
# 1. Create schemas (needed for AI features — skip if not using them)
ssh <SERVER> "docker exec <DB_CONTAINER> psql -U <DB_USER> -d <DB_NAME> -c \
  'CREATE SCHEMA IF NOT EXISTS chat; CREATE SCHEMA IF NOT EXISTS pdf; CREATE SCHEMA IF NOT EXISTS image;'"

# 2. Get DB container IP (host can't resolve Docker DNS)
ssh <SERVER> "docker inspect <DB_CONTAINER> --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'"

# 3. SSH tunnel
ssh -f -N -L 5440:<CONTAINER_IP>:5432 <SERVER>

# 4. Push schema (MUST run from packages/db directory)
cd packages/db
DATABASE_URL="postgres://<DB_USER>:<DB_PASS>@localhost:5440/<DB_NAME>" npx drizzle-kit push --force

# 5. Seed users (run from packages/auth directory)
cd ../auth
SKIP_ENV_VALIDATION=1 \
DATABASE_URL="postgres://<DB_USER>:<DB_PASS>@localhost:5440/<DB_NAME>" \
BETTER_AUTH_SECRET="<YOUR_SECRET>" \
npx tsx ./src/scripts/seed.ts

# 6. Kill tunnel
pkill -f "ssh -f -N -L 5440"
```

## Step 7: Verify

Open your app URL. Sign in with:
- Email: value of `SEED_EMAIL` (default: `dev@example.com`)
- Password: value of `SEED_PASSWORD` (default: `Pa$$w0rd`)

---

## Redeploy (After Code Changes)

```bash
# 1. Build & push new image
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_URL=https://your-app.example.com \
  -t <REGISTRY_HOST>/<ORG>/<APP>:latest .
docker push <REGISTRY_HOST>/<ORG>/<APP>:latest

# 2. Pull new image on the server (required — Coolify won't pull automatically)
ssh <SERVER> "docker pull localhost:<REGISTRY_PORT>/<ORG>/<APP>:latest"

# 3. Restart via Coolify (stop + start, or MCP restart)
```

**If containers get stuck in "Created" state after restart:**
```bash
# Coolify sometimes leaves containers in "Created" state after stop+start.
# Fix: manually start them in dependency order:
ssh <SERVER> "docker start <DB_CONTAINER> <MINIO_CONTAINER>"
# Wait ~15s for healthchecks, then:
ssh <SERVER> "docker start <WEB_CONTAINER>"

# Or nuclear option: Coolify stop, then start again (creates fresh containers)
```

---

## Runtime Env Validation

The app validates environment variables **at startup** (not build time):

| Category | Behavior |
|----------|----------|
| `DATABASE_URL`, `BETTER_AUTH_SECRET` | **Required** — app exits with clear error if missing |
| S3 vars (when `S3_BUCKET` is set) | **Feature-gated** — required only when feature is enabled |
| Stripe vars (when `STRIPE_SECRET_KEY` is set) | **Feature-gated** — required only when feature is enabled |
| Email vars (when provider key is set) | **Feature-gated** — required only when feature is enabled |
| `BETTER_AUTH_TRUSTED_ORIGINS` | **Warning** — app starts but logs a warning |
| Monitoring, analytics | **Optional** — silently disabled if not set |

This means: **if the app starts, it's fully configured**. No silent failures.

---

## Critical Rules

1. **Image name in compose**: Use `localhost:<PORT>/...` — not the external IP (avoids HTTPS errors)
2. **FQDN must be `http://`** when TLS is handled externally (Tailscale, Cloudflare)
3. **`minio-init` must have `restart: "no"`** — Coolify adds `unless-stopped` by default
4. **Healthcheck uses `node -e "fetch(...)"`** — `node:22-slim` has no wget/curl
5. **`NEXT_PUBLIC_URL` is a build arg** — baked at compile time, must rebuild to change
6. **`BETTER_AUTH_TRUSTED_ORIGINS` is runtime** — comma-separated allowed origins
7. **drizzle-kit runs from `packages/db/`** — not from repo root
8. **SSH tunnel uses container IP** — not container name (host can't resolve Docker DNS)
9. **Seed script is at `packages/auth/`** — `packages/db/` seed is a placeholder
10. **Don't build on small VPS** — cross-compile locally to avoid OOM
11. **Pull image on server before restarting** — Coolify won't auto-pull from local registries
12. **Containers stuck in "Created"** — Coolify bug; manually `docker start` in dependency order (db → minio → web)
