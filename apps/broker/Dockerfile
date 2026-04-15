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

# Install all workspace deps, then flatten broker's prod subset into /deploy.
# pnpm deploy: resolves workspace:* to real copies, drops catalog: references,
# drops devDependencies (--prod), produces a self-contained runtime directory
# with only what this one package + its transitive prod deps need.
RUN pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm deploy --legacy --prod --ignore-scripts --filter=@claudemesh/broker /deploy

# Stage 2: minimal Bun runtime — copy only the flat /deploy subset
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

# Git SHA baked in at build-time → surfaced on /health (spec: apps/broker/DEPLOY_SPEC.md)
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

ENV NODE_ENV=production
ENV BROKER_PORT=7900

COPY --from=deps --chown=bun:bun /deploy /app

# Copy migrations folder alongside the broker so runtime auto-migrate
# has files to apply. Workspace deploy subset drops them otherwise.
COPY --from=deps --chown=bun:bun /app/packages/db/migrations /app/migrations

EXPOSE 7900

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD bun -e "fetch('http://localhost:7900/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

# Non-root user (oven/bun image ships with 'bun' uid 1000)
USER bun
CMD ["bun", "src/index.ts"]
