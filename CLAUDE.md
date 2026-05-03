# claudemesh

Peer mesh for Claude Code sessions. Broker + CLI + MCP server.

## Structure

- `apps/broker/` — WebSocket broker (Bun + Drizzle + PostgreSQL), deployed at `wss://ic.claudemesh.com/ws`. Runs drizzle migrations on startup under pg_advisory_lock.
- `apps/cli/` — `claudemesh-cli` npm package (CLI + MCP server). Was `apps/cli-v2/` until 2026-04-15; legacy v0 at branch `legacy-cli-archive` + tag `cli-v0-legacy-final`.
- `apps/web/` — Marketing site + dashboard at claudemesh.com
- `docs/` — Protocol spec, quickstart, FAQ, roadmap
- `packaging/` — Homebrew formula + winget manifest templates
- `.github/workflows/release-cli.yml` — tag `cli-v*` → 5 platform binaries → GitHub Release with SHA256SUMS

## Key docs

- `SPEC.md` — What claudemesh is, protocol, crypto, wire format
- `docs/protocol.md` — Wire protocol reference
- `docs/roadmap.md` — Public roadmap (shipped + planned)
- `docs/vision-20260407.md` — Internal feature brainstorm with 19 ideas across 3 tiers, effort estimates, and build order

## Deploy

- **Broker:** `git push gitea-vps main` triggers Coolify auto-deploy via the gitea webhook. Pending migrations apply automatically on startup.
- **Web:** Coolify on the OVH VPS (`claudemesh.com` resolves to `135.125.191.245`, NOT Vercel — the `apps/web/Dockerfile` is what Coolify builds). Auto-deploys via `.github/workflows/deploy-web.yml` on push to `main` when paths under `apps/web/**` or `packages/{api,db,auth,ui,i18n,shared,email,billing,storage,monitoring-web}/**` change. The workflow joins the tailnet via Tailscale OAuth, then hits the Coolify API.
- **Manual deploy** (if the workflow is broken or the path filter missed something) — Coolify dashboard at `http://100.122.34.28:8000` (Tailscale only). Token in `COOLIFY_TOKEN` repo secret. App UUIDs: broker `mcn8m74tbxfxbplmyb40b2ia`, web `p68x1e3k4xmrjmblca5ybe09`.
- **CLI:**
  - npm: `cd apps/cli && npm publish --access public --no-git-checks --ignore-scripts`
  - Binaries: `git tag cli-v<version> && git push github cli-v<version>` — workflow builds 5 platforms.

## Dev

- Monorepo: pnpm workspaces + Turborepo
- Broker dev: `cd apps/broker && bun --hot src/index.ts`
- CLI build: `cd apps/cli && pnpm build` (Bun bundler)
- CLI link for local testing: `cd apps/cli && npm link`
