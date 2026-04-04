# claudemesh broker — production Dockerfile
# Bun runtime (executes .ts directly, no build step required).
# Build from repo root:  docker build -f apps/broker/Dockerfile -t claudemesh-broker .

# Stage 1: resolve pnpm workspace + install deps (Bun base + standalone pnpm)
FROM oven/bun:1.2 AS deps
WORKDIR /app

# Install standalone pnpm binary (no Node needed — pnpm ships as a single ELF)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v10.25.0/pnpm-linuxstatic-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

# Copy full workspace (pnpm needs lockfile + all package.jsons to resolve workspace:* and catalog:)
COPY . .

# Install all workspace deps (broker needs @turbostarter/db + @turbostarter/shared and their transitive deps)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: minimal Bun runtime
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

# Git SHA baked in at build-time → surfaced on /health (spec: apps/broker/DEPLOY_SPEC.md)
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

ENV NODE_ENV=production
ENV BROKER_PORT=7900

# Copy workspace root metadata + node_modules + only the packages the broker needs
COPY --from=deps --chown=bun:bun /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /app/apps/broker ./apps/broker
COPY --from=deps --chown=bun:bun /app/packages/db ./packages/db
COPY --from=deps --chown=bun:bun /app/packages/shared ./packages/shared
COPY --from=deps --chown=bun:bun /app/tooling/typescript ./tooling/typescript

EXPOSE 7900

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:7900/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

# Non-root user (oven/bun image ships with 'bun' uid 1000)
USER bun
CMD ["bun", "apps/broker/src/index.ts"]
