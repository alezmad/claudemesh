# Autonomous Project Setup Prompt

Copy and paste the following prompt into Claude Code (or any AI coding agent) to autonomously set up this project from scratch.

---

## Prompt

```
Clone and fully set up the TurboStarter Kit project so that `pnpm dev` runs successfully with the web app accessible at http://localhost:3000.

Repository: https://github.com/mou-minery/turbostarter-kit

Execute every step below in order. Stop and report if any step fails.

### Step 1: Clone the repository

git clone https://github.com/mou-minery/turbostarter-kit.git
cd turbostarter-kit

### Step 2: Verify prerequisites

Check that the following are installed and meet minimum versions. If any are missing, stop and report:
- Node.js >= 22.17.0 (`node --version`)
- pnpm 10.25.0 (`pnpm --version` — if missing, run `corepack enable && corepack prepare pnpm@10.25.0 --activate`)
- Docker and Docker Compose (`docker --version` and `docker compose version`)

Also verify Docker daemon is running: `docker info`

### Step 3: Install dependencies

pnpm install

### Step 4: Create root .env file

Create `.env` in the project root with this exact content:

DATABASE_URL="postgresql://turbostarter:turbostarter@localhost:5440/core"
PRODUCT_NAME="TurboStarter"
URL="http://localhost:3000"
DEFAULT_LOCALE="en"

CRITICAL: The database port MUST be 5440 (not 5432). The docker-compose.yml maps container port 5432 to host port 5440.

### Step 5: Create apps/web/.env.local file

Copy the example and apply necessary overrides:

cp apps/web/.env.example apps/web/.env.local

Then edit apps/web/.env.local to ensure these values are set correctly:

# These MUST reference the root .env values correctly
NEXT_PUBLIC_PRODUCT_NAME="TurboStarter"
NEXT_PUBLIC_URL="http://localhost:3000"
NEXT_PUBLIC_DEFAULT_LOCALE="en"

# Theme
NEXT_PUBLIC_THEME_MODE="system"
NEXT_PUBLIC_THEME_COLOR="orange"

# Auth — password login enabled, magic link disabled
NEXT_PUBLIC_AUTH_PASSWORD="true"
NEXT_PUBLIC_AUTH_MAGIC_LINK="false"
NEXT_PUBLIC_AUTH_PASSKEY="true"
NEXT_PUBLIC_AUTH_ANONYMOUS="true"
BETTER_AUTH_SECRET="lT4GdPj3OSx00OcTRUdwywn1DNgBBuvK"

# Seed credentials for dev accounts
SEED_EMAIL="me@turbostarter.dev"
SEED_PASSWORD="Pa$$w0rd"

# Billing
BILLING_MODEL="recurring"

# Email — use default "noreply" so no real provider is needed
EMAIL_FROM="hello@resend.dev"
CONTACT_EMAIL="hello@resend.dev"

# Storage — point to local MinIO from docker-compose
S3_REGION="us-east-1"
S3_BUCKET="uploads"
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"

Leave ALL other optional provider variables (Stripe, Resend, Sentry, PostHog, OpenAI, etc.) with their placeholder values or empty — they are all optional and validated with `optional()` in the zod schemas. The app will start without them.

DO NOT remove any `<your-...>` placeholder lines — leave them as-is. They will not cause errors because env validation treats them as optional strings.

### Step 6: Start Docker infrastructure

Start PostgreSQL (pgvector) and MinIO:

docker compose up -d --wait

Verify both services are healthy:

docker compose ps

Expected: both `db` and `minio` should show status "healthy". The `minio-init` service will run once and exit (status "exited (0)" is normal — it creates the uploads bucket).

If services are not healthy after 60 seconds, check logs with `docker compose logs` and report the error.

### Step 7: Verify database connectivity

Test that PostgreSQL is reachable on port 5440:

docker compose exec db pg_isready -U turbostarter

This should print "accepting connections".

### Step 8: Run database migrations and seed

pnpm services:setup

This command:
1. Starts docker services (already running, so it's a no-op)
2. Runs database migrations via drizzle-kit (`db:migrate`)
3. Seeds initial data (`db:seed`)

If `pnpm services:setup` fails, try running the steps individually:

pnpm with-env turbo setup

Or manually:

pnpm --filter @turbostarter/db db:migrate
pnpm --filter @turbostarter/db db:seed

Then seed auth accounts:

# This requires sourcing the web env file first
set -a && source apps/web/.env.local && set +a && pnpm --filter @turbostarter/auth db:seed

### Step 9: Start the development server

pnpm dev

This starts all workspace apps via Turborepo. The Next.js web app should compile and become available at http://localhost:3000.

### Step 10: Verify the app is working

Wait for the dev server to finish compiling (watch for "Ready" or "compiled" in the output), then verify:

curl -s -o /dev/null -w "%{http_code}" http://localhost:3000

Expected: HTTP 200 (or 307 redirect which also means the app is running).

If you get a non-zero exit code or connection refused, wait 15 more seconds and retry — Next.js needs time to compile on first request.

### Step 11: Verify dev login works

Open http://localhost:3000 in a browser. You should be able to log in with:
- Email: me+user@turbostarter.dev
- Password: Pa$$w0rd

Or the admin account:
- Email: me+admin@turbostarter.dev
- Password: Pa$$w0rd

### Troubleshooting

If any step fails, check these common issues:

1. **Port 5440 already in use**: Another PostgreSQL or service is using port 5440. Run `lsof -i :5440` to find it, or change POSTGRES_PORT in docker-compose.yml and update DATABASE_URL accordingly.

2. **Port 9000/9001 already in use**: Another service (often another MinIO instance) is using the port. Run `docker compose down` first to clean up, or change MINIO_API_PORT/MINIO_CONSOLE_PORT.

3. **pnpm install fails**: Make sure you're using pnpm 10.25.0 exactly. Run `corepack prepare pnpm@10.25.0 --activate`.

4. **Node version too old**: This project requires Node >= 22.17.0. Use nvm or fnm to install: `nvm install 22`

5. **Database migration fails**: Ensure Docker services are healthy first. Check `docker compose logs db` for PostgreSQL errors.

6. **Build errors about missing env vars**: The build uses SKIP_ENV_VALIDATION. If you still get errors, ensure the root .env and apps/web/.env.local both exist and have the values from steps 4-5.

7. **"Module not found" or dependency errors**: Run `pnpm install` again. If it persists, run `pnpm clean` then `pnpm install`.

### Service URLs after setup

| Service         | URL                    | Credentials                        |
|-----------------|------------------------|------------------------------------|
| Web App         | http://localhost:3000  | See dev login above                |
| PostgreSQL      | localhost:5440         | turbostarter / turbostarter        |
| MinIO API       | http://localhost:9000  | minioadmin / minioadmin            |
| MinIO Console   | http://localhost:9001  | minioadmin / minioadmin            |

### Cleanup commands

To stop everything:
  pnpm services:stop   # stops Docker containers
  # Ctrl+C to stop the dev server

To reset everything:
  docker compose down -v   # removes containers AND data volumes
  pnpm --filter @turbostarter/db db:reset
```
