# TurboStarter Kit

Full-stack monorepo built with Next.js, Expo, Turborepo, and pnpm workspaces.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22.17.0
- [pnpm](https://pnpm.io/) 10.25.0
- [Docker](https://www.docker.com/) and Docker Compose

## Project Structure

```
apps/
  web/       # Next.js web application (port 3000)
  mobile/    # Expo React Native app
packages/
  ai/        # AI provider integrations
  analytics/ # Analytics providers
  api/       # tRPC API layer
  auth/      # Authentication (BetterAuth)
  billing/   # Payment providers (Stripe, Lemon Squeezy, Polar)
  cms/       # Content management
  db/        # Database (Drizzle ORM + PostgreSQL)
  email/     # Email providers (Resend, Sendgrid, etc.)
  i18n/      # Internationalization
  monitoring/# Monitoring (Sentry, PostHog)
  shared/    # Shared utilities and config
  storage/   # File storage (S3/MinIO)
  ui/        # Shared UI components
```

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Copy the example env files:

```bash
# Root env (database, product name, URL)
cp .env.example .env

# Web app env (auth, billing, email, storage, AI, etc.)
cp apps/web/.env.example apps/web/.env.local
```

**Root `.env`** — minimum required variables:

```env
DATABASE_URL="postgresql://turbostarter:turbostarter@localhost:5440/core"
PRODUCT_NAME="TurboStarter"
URL="http://localhost:3000"
DEFAULT_LOCALE="en"
```

> **Note:** The database port is `5440` (mapped from Docker), not the default `5432`.

**`apps/web/.env.local`** — key variables to configure:

| Variable | Description | Required |
|---|---|---|
| `BETTER_AUTH_SECRET` | Auth token signing secret | Yes |
| `NEXT_PUBLIC_AUTH_PASSWORD` | Enable password auth (`true`/`false`) | Yes |
| `NEXT_PUBLIC_URL` | Public URL of the web app | Yes |
| `STRIPE_SECRET_KEY` | Stripe key (if using Stripe billing) | Optional |
| `RESEND_API_KEY` | Resend key (if using Resend email) | Optional |
| `S3_*` | S3/MinIO storage credentials | Optional |
| `OPENAI_API_KEY` | OpenAI key (if using AI features) | Optional |

For local MinIO storage, use these S3 settings in `apps/web/.env.local`:

```env
S3_REGION="us-east-1"
S3_BUCKET="uploads"
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
```

See `apps/web/.env.example` for the full list of available variables.

### 3. Start infrastructure (Docker Compose)

Start PostgreSQL and MinIO:

```bash
docker compose up -d
```

Wait for services to be healthy:

```bash
docker compose up -d --wait
```

Or use the built-in shortcut:

```bash
pnpm services:start
```

### 4. Set up the database

Run migrations and seed data:

```bash
pnpm services:setup
```

This runs `docker compose up -d --wait`, then applies database migrations and seeds initial data.

### 5. Start development

```bash
pnpm dev
```

The web app will be available at **http://localhost:3000**.

## Docker Commands

### Infrastructure Services

| Command | Description |
|---|---|
| `docker compose up -d` | Start all services (PostgreSQL + MinIO) |
| `docker compose down` | Stop all services |
| `docker compose logs -f` | Follow service logs |
| `docker compose ps` | Show service status |

Or use the pnpm shortcuts:

| Command | Description |
|---|---|
| `pnpm services:start` | Start Docker services and wait for healthy |
| `pnpm services:stop` | Stop Docker services |
| `pnpm services:logs` | Follow Docker service logs |
| `pnpm services:status` | Show Docker service status |
| `pnpm services:setup` | Start services + run DB migrations + seed |

### Service URLs

| Service | URL | Credentials |
|---|---|---|
| Web App | http://localhost:3000 | — |
| PostgreSQL | localhost:5440 | `turbostarter` / `turbostarter` |
| MinIO API | http://localhost:9000 | `minioadmin` / `minioadmin` |
| MinIO Console | http://localhost:9001 | `minioadmin` / `minioadmin` |

### Production Build (Docker)

Build and run the web app as a production Docker image:

```bash
docker build -t turbostarter-web .
docker run -p 3000:3000 --env-file apps/web/.env.local turbostarter-web
```

## Development Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | Run ESLint across the monorepo |
| `pnpm format` | Check formatting with Prettier |
| `pnpm format:fix` | Fix formatting |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run tests |
| `pnpm auth:seed` | Seed auth dev accounts |

### Database Commands

Run from the root (or within `packages/db`):

| Command | Description |
|---|---|
| `pnpm --filter @turbostarter/db db:migrate` | Run database migrations |
| `pnpm --filter @turbostarter/db db:push` | Push schema changes |
| `pnpm --filter @turbostarter/db db:generate` | Generate new migration |
| `pnpm --filter @turbostarter/db db:studio` | Open Drizzle Studio |
| `pnpm --filter @turbostarter/db db:reset` | Reset database |
| `pnpm --filter @turbostarter/db db:seed` | Seed database |

## Dev Login Credentials

After running `pnpm services:setup` or `pnpm auth:seed`:

| Role | Email | Password |
|---|---|---|
| User | `me+user@turbostarter.dev` | `Pa$$w0rd` |
| Admin | `me+admin@turbostarter.dev` | `Pa$$w0rd` |
