# claudemesh web (Next.js) — production Dockerfile
# Build from repo root:  docker build -f apps/web/Dockerfile -t claudemesh-web .

# Stage 1: builder — install + turbo build (Next.js standalone output)
FROM node:22-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

# pnpm workspace needs full context to resolve workspace:* + catalog:
COPY . .

# --ignore-scripts skips sherif postinstall linting (exits 1 on warnings)
RUN pnpm install --frozen-lockfile --ignore-scripts && \
    node node_modules/esbuild/install.js && \
    node node_modules/sharp/install/check.js || npm run --prefix node_modules/sharp build 2>/dev/null; \
    true

# Build — SKIP_ENV_VALIDATION lets missing runtime vars pass (validated at startup instead)
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=1

# NEXT_PUBLIC_* vars are BAKED at build time in Next standalone — must be passed as build args
ARG NEXT_PUBLIC_URL=https://claudemesh.com
ARG NEXT_PUBLIC_PRODUCT_NAME=claudemesh
ARG NEXT_PUBLIC_DEFAULT_LOCALE=en
ENV NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL
ENV NEXT_PUBLIC_PRODUCT_NAME=$NEXT_PUBLIC_PRODUCT_NAME
ENV NEXT_PUBLIC_DEFAULT_LOCALE=$NEXT_PUBLIC_DEFAULT_LOCALE

# Node ESM loader that stubs .css imports during route collection.
# Payload CMS deps import .css files that Node can't handle outside webpack.
ENV NODE_OPTIONS="--import /app/apps/web/css-stub-loader.mjs"
RUN npx turbo run build --filter=web...

# Stage 2: runtime — standalone output only
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
