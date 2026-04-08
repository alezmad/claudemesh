# claudemesh runner — executes deployed MCP servers as child processes.
# Multi-runtime: Node 22 + Python 3.12 + uv + Bun
#
# The runner supervisor (Node) listens on HTTP :7901 for commands from
# the broker (load, call, unload, health, list_tools). Each deployed
# MCP server runs as a child process with its own stdio pipe.

FROM node:22-slim AS base

# Install Python 3.12 + uv (fast pip replacement) + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    curl ca-certificates git \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -sf /root/.local/bin/uv /usr/local/bin/uv \
    && ln -sf /root/.local/bin/uvx /usr/local/bin/uvx \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (for bun-based MCP servers)
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

WORKDIR /app

# Copy the runner supervisor
COPY supervisor.mjs /app/supervisor.mjs

# Services directory (shared volume with broker)
RUN mkdir -p /var/claudemesh/services

ENV NODE_ENV=production
ENV RUNNER_PORT=7901

EXPOSE 7901

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:7901/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "supervisor.mjs"]
