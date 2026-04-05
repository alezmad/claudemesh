# claudemesh db — drizzle-kit migration runner
# One-shot container: runs `drizzle-kit migrate` against $DATABASE_URL then exits 0.
# Used as a pre-deploy init container so the web service never starts against a
# schema it doesn't know about.
#
# Build from repo root:  docker build -f packages/db/Dockerfile -t claudemesh-migrate .

# Stage 1: resolve pnpm workspace + install deps (Bun base + standalone pnpm)
FROM oven/bun:1.2 AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v10.25.0/pnpm-linuxstatic-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

# pnpm needs full workspace context to resolve workspace:* and catalog: specifiers
COPY . .

# drizzle-kit is a devDependency → install the full dep graph (NOT --prod).
# Filter to db + its transitive deps only → ~20x smaller install than the whole workspace.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@turbostarter/db..."

# Stage 2: minimal Bun runtime (executes drizzle-kit CLI + TS config)
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Copy workspace metadata, the db package (schema + migrations + config), shared (transitive)
COPY --from=deps --chown=bun:bun /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /app/packages/db ./packages/db
COPY --from=deps --chown=bun:bun /app/packages/shared ./packages/shared
COPY --from=deps --chown=bun:bun /app/tooling/typescript ./tooling/typescript

USER bun
WORKDIR /app/packages/db

# drizzle-kit reads DATABASE_URL from env via ./src/env.ts, runs pending migrations,
# exits 0 on success / non-zero on failure. No long-running process.
CMD ["bun", "x", "drizzle-kit", "migrate"]
