# Turbostarter Production Dockerfile
# Single-stage build (mimics nixpacks) + slim production image
# Build locally on Mac, push to Gitea registry, deploy via Coolify

# Stage 1: Build everything in one layer (like nixpacks does)
FROM node:22-slim AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

# Copy everything (pnpm workspaces need full context for resolution)
COPY . .

# Install all dependencies (hoisted, same as nixpacks)
RUN pnpm install --frozen-lockfile

# Build — SKIP_ENV_VALIDATION=1 so missing runtime vars don't block build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=1
ARG NEXT_PUBLIC_URL=http://localhost:3000
ENV NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL
RUN npx turbo run build

# Stage 2: Minimal production image
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output from builder
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
