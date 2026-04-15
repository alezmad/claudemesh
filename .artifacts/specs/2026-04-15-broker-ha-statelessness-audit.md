# Broker HA readiness — statelessness audit

Single-instance broker is the biggest GA blocker. Moving to 2+ replicas
behind a load balancer requires first understanding which state the broker
holds in-process that breaks if split across nodes.

## Current in-process state (apps/broker/src/index.ts)

| Symbol | Line | Per-node? | Survives HA? | Notes |
|--------|------|-----------|--------------|-------|
| `connections` | 147 | yes (WS state) | ✅ naturally per-node | WS connections are pinned to a node by L7 routing. Each node holds only its own connections. **OK as long as the LB uses sticky sessions or cross-node fan-out.** |
| `connectionsPerMesh` | 148 | yes | 🟡 per-node count, not global | Used for capacity cap. Global cap requires Redis. |
| `tgTokenRateLimit` | 151 | yes | 🟡 per-node | Telegram bot rate limiting; tolerable as per-node. |
| `urlWatches` | 173 | yes | 🔴 stuck on one node | If peer disconnects from node A and reconnects on B, the watch stays orphaned on A. **Needs DB/Redis, or "pin to owning node". Acceptable risk if watches are per-session ephemeral.** |
| `streamSubscriptions` | 259 | yes | 🔴 multi-node broken | Sub on A, publish on B → message never reaches A's subscribers. **Needs Redis pub/sub for HA.** |
| `meshClocks` | 270 | yes | 🔴 multi-node broken | Simulated clocks must be single-authority. Solve by pinning one node as clock leader (simple leader election) or by moving clock state to DB. |
| `mcpRegistry` | 327 | yes | 🔴 multi-node broken | MCP server catalog cached in memory. If deployed on A but called on B, B doesn't know it exists. **Must be DB-backed** (partly is already — see `mesh_service` table). Audit the cache/DB sync path. |
| `mcpCallResolvers` | 338 | yes | ✅ per-call ephemeral | In-flight callback resolvers; WS sticks to owning node so this is fine. |
| `scheduledMessages` | 359 | yes | 🔴 multi-node broken | Scheduled delivery timers live in-process. Restart loses them. Persistence exists (`scheduled_message` table) + recovery on startup, but two nodes could both fire the same timer. **Needs a leader lock or per-schedule pg_advisory_lock on fire.** |
| `sendRateLimit` | index.ts:494 | yes | 🟡 per-node | Each node enforces its own quota; a client spread across nodes could 2x the limit. Tolerable if sticky sessions hold. |
| `hookRateLimit` | index.ts:482 | yes | 🟡 per-node | Same as sendRateLimit. |
| `lastHash` (audit.ts:22) | — | yes | 🔴 broken on write | Two nodes writing audit rows concurrently will BOTH read the same last hash, BOTH compute a new hash, and both INSERT — the chain forks. **Needs `SELECT FOR UPDATE` or a single audit writer.** |

## Conclusion

**Current broker is NOT HA-safe.** Five symbols break under multi-instance:
`urlWatches`, `streamSubscriptions`, `meshClocks`, `mcpRegistry` cache,
`scheduledMessages`, `lastHash`. None are unsolvable, but none are
trivial.

## Rollout plan for HA

### Phase 0 (now) — sticky sessions
Deploy a single broker behind Traefik with `loadBalancer.sticky.cookie`
enabled. WS upgrade inherits the cookie, so reconnects land on the same
node. Gives us 1 node of safe HA headroom (i.e., one deploy rollover
without user-visible disconnection) without any code changes.

### Phase 1 — Active/passive
Two replicas. Traefik routes all traffic to primary; secondary is warm.
Primary fails → secondary takes over, all WS connections reset. No code
change needed; clients auto-reconnect.

### Phase 2 — Active/active for stateless routes
HTTP-only routes (`/cli/*`, `/download`, `/hook`) can round-robin across
any number of replicas today. WS routes stay sticky per mesh via Traefik
`sticky.cookie`. Already behind Postgres → each replica reads the same
mesh/member/invite rows.

### Phase 3 — Full active/active
Migrate the 6 problematic in-memory symbols:
- `streamSubscriptions` → Redis pub/sub
- `meshClocks` → leader-elect via Postgres advisory lock on mesh_id
- `scheduledMessages` → single-writer pattern: whichever replica holds
  `pg_advisory_xact_lock(schedule_id)` fires
- `urlWatches` → DB-backed + each replica owns watches where
  `presence.node_id = this_node`
- `mcpRegistry` → rely on `mesh_service` table, drop the in-memory cache
- `lastHash` → wrap audit.ts writes in a transaction that
  `SELECT hash FROM audit_log ... ORDER BY id DESC FOR UPDATE`, making
  concurrent inserts serialize.

### Phase 4 — Multi-region
SPOF at Frankfurt (OVH). Move to a managed Postgres with read replicas,
one broker cluster per region, global DNS geo-routing. Out of scope for
v1.0.0.

## Immediate ship: local docker-compose for 2-replica smoke test

`packaging/docker-compose.ha-local.yml` (TODO) spins up:
- 2x broker (same DATABASE_URL)
- 1x postgres
- 1x traefik with sticky cookie
- 1x locust / synthetic client

Tests:
1. Send to peer connected on node A → delivered.
2. Subscribe on A, publish on B → expect failure (documents the gap).
3. Kill node A → client reconnects to B within Xs.
4. Audit chain verify after concurrent writes from both nodes → expect
   a fork (documents the gap).

## Decision

**Ship v1.0.0 on sticky-session single-writer (Phase 0 + Phase 1 warm
standby).** That closes the "what happens on deploy" story. Phase 3 full
HA is v1.1.0 work.
