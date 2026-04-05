# claudemesh db — drizzle-kit migration runner
# One-shot container: runs `drizzle-kit migrate` against $DATABASE_URL then exits 0.
# Used as a pre-deploy init container so the web service never starts against a
# schema it doesn't know about.
#
# Build from repo root:  docker build -f packages/db/Dockerfile -t claudemesh-migrate .

# Stage 1: resolve pnpm workspace + flatten db's subset to /deploy via pnpm deploy
FROM oven/bun:1.2 AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v10.25.0/pnpm-linuxstatic-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

# pnpm needs full workspace context to resolve workspace:* and catalog: specifiers
COPY . .

# Install full workspace, then flatten the db package's deploy subset.
# Keeps devDependencies (--no `--prod`) because drizzle-kit IS the runtime here.
RUN pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm deploy --legacy --ignore-scripts --filter=@turbostarter/db /deploy

# Stage 2: minimal Bun runtime — copy only /deploy
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps --chown=bun:bun /deploy /app

USER bun

# drizzle-kit reads DATABASE_URL from env via ./src/env.ts, runs pending migrations,
# exits 0 on success / non-zero on failure. No long-running process.
CMD ["bun", "x", "drizzle-kit", "migrate"]
