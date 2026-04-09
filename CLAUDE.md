# claudemesh

Peer mesh for Claude Code sessions. Broker + CLI + MCP server.

## Structure

- `apps/broker/` — WebSocket broker (Bun + Drizzle + PostgreSQL), deployed at `wss://ic.claudemesh.com/ws`
- `apps/cli/` — `claudemesh-cli` npm package (CLI + MCP server)
- `apps/web/` — Marketing site + dashboard at claudemesh.com
- `docs/` — Protocol spec, quickstart, FAQ, roadmap

## Key docs

- `SPEC.md` — What claudemesh is, protocol, crypto, wire format
- `docs/protocol.md` — Wire protocol reference
- `docs/roadmap.md` — Public roadmap (shipped + planned)
- `docs/vision-20260407.md` — Internal feature brainstorm with 19 ideas across 3 tiers, effort estimates, and build order

## Deploy

- **Broker:** `git push gitea-vps main` triggers Coolify auto-deploy. Manual: `curl -s -X GET "http://100.122.34.28:8000/api/v1/deploy?uuid=mcn8m74tbxfxbplmyb40b2ia" -H "Authorization: Bearer 3|K2vkSJzdUA69rj22CKZc5z0YB6pkY43GLEonti3UzcnqVJj6WhrqqYTAng6DzMUi"`
- **CLI:** `cd apps/cli && pnpm publish --access public --no-git-checks`
- **Web:** Vercel auto-deploy on push to GitHub

## Dev

- Monorepo: pnpm workspaces + Turborepo
- Broker dev: `cd apps/broker && bun --hot src/index.ts`
- CLI build: `cd apps/cli && pnpm build` (Bun bundler)
- CLI link for local testing: `cd apps/cli && npm link`
