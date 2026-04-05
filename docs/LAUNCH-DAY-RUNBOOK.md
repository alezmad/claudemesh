# claudemesh v0.1.0 — Launch Day Runbook

## T-30min: Final Checks
- `dig claudemesh.com` and `dig ic.claudemesh.com` resolve to VPS.
- `curl -I https://claudemesh.com/health` and `https://ic.claudemesh.com/health` return 200.
- Verify Traefik TLS cert (not expiring in 30 days).
- `npm publish --dry-run` on CLI package; confirm version is 0.1.0.
- Tail broker and web logs in Coolify.
- Confirm pg_dump cron loaded (`systemctl list-timers | grep pg_dump`).
- Silence unrelated alerts; pin on-call rotation.

## T-0: Launch
- Fire HN "Show HN: claudemesh" post.
- Cross-post to r/LocalLLaMA, r/ClaudeAI, r/selfhosted.
- Thread owner pins themselves for the first 6h to answer every comment.
- Share on X/Bluesky/LinkedIn.

## First 6h — Watch Window
- Broker `/metrics`: `claudemesh_ws_connections` — alarm >500.
- Web + broker 429 rate: if >2% of traffic, raise limits.
- Postgres: `pg_stat_activity` connection count; backups run 03:00 UTC (don't interrupt).
- Traefik logs: TLS renewal errors, 5xx spikes.
- Signup funnel + mesh-create events every 30 min.
- Broker memory on VPS (`docker stats`): escalate at >80%.

## Common Failures — Responses
- **Broker OOM**: bump container memory in Coolify to 2GB, redeploy. Review connection leaks after.
- **DB pool saturation**: restart web container to recycle pool; if persistent, raise `DATABASE_POOL_MAX` to 30.
- **Rate-limits hitting legit traffic**: temporarily raise web to 200 rps, broker to 80 rps via env vars; redeploy.
- **Webhook deploy backlog**: cancel redundant queued deploys in Coolify; keep only the latest.
- **Signup flow broken**: roll web back to previous green tag (Coolify "Redeploy previous").
- **Broker crash loop**: check WSS handshake logs, disable new connections via feature flag, investigate.

## Who to Page
- **Broker bugs, WSS, protocol** → `claudemesh` peer.
- **Web UI, signup, dashboard** → `claudemesh-2` peer.
- **VPS, Traefik, DNS, Postgres, Coolify** → `ovhcloud-agutmou` peer.
- **DB schema / migrations** → `claudemesh` peer.
- **CLI / npm package** → `claudemesh` peer.

## T+24h: Post-Launch
- Pull metrics: peak connections, signup count, mesh count, 429 rate, p95 latency.
- Review rate-limit hits; adjust ceilings to real traffic shape.
- Triage GitHub issues opened during launch; tag v0.2 candidates.
- Retro with peers: biggest fire, biggest win, one fix for v0.2.
- Schedule v0.2 planning for T+72h.
