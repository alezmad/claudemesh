# claudemesh handoff — 2026-05-02 (evening)

Companion to the morning handoff (`2026-05-02-handoff.md`). Captures
what shipped through the v1.6.x patch line and the v1.7.0 demo cut.
Read before the next session.

---

## What shipped this evening

### v1.6.x patch line — closed except bridge smoke test

| Feature | Endpoint / file | Commit |
|---|---|---|
| SSE topic stream | `GET /api/v1/topics/:name/stream` | `7e71a61` |
| Unread counts | `PATCH /v1/topics/:name/read`, `unread` on `GET /v1/topics` | `a80eb6f` |
| Mesh-card unread badges | `apps/web/src/app/[locale]/dashboard/(user)/page.tsx` | `541440c` |
| Member sidebar | `GET /v1/members`, chat panel right rail | `a75483b` |
| SSE 4xx-stop fix | `apps/web/src/modules/mesh/topic-chat-panel.tsx` | `7af61e1` |
| Humans-as-peers | `GET /v1/peers` includes recent apikey users | `f4601f4` |

### v1.7.0 demo cut — 4 of 5 items shipped

| Item | Code | Commit |
|---|---|---|
| Member sidebar in chat | `apps/web/src/modules/mesh/topic-chat-panel.tsx` (+sidebar) | `a75483b` |
| Topic search + autocomplete | Same file (+ search toggle, mention dropdown, clay highlight) | `35a289b`, `00c25d9` |
| Notification feed | `MentionsSection` on universe + `GET /v1/notifications` | `a9160a0` |
| Public blog post | `apps/web/src/app/[locale]/(marketing)/blog/agents-and-humans-same-chat/` | `69cf39b` |
| Demo video script | `docs/demo-v1.7.0-script.md` (90s, 5 scenes) | `69cf39b` |
| Marketing site refresh | Timeline next-block updated | `a2ab7de` |
| **Recorded demo video** | — | **TODO (needs human + iTerm + Chrome)** |
| **Marketing screenshots** | — | **TODO (needs Chrome session)** |

### Roadmap state

- `docs/roadmap.md` updated. v1.6.x marks every endpoint shipped except
  bridge smoke test. v1.7.0 marks sidebar/mentions/search/feed/blog
  shipped; recording + screenshots open.
- v2.0.0 (daemon redesign) and v0.3.0 (operator layer / per-topic
  encryption) untouched — both still architectural specs.

---

## Live status

- **Broker** (`wss://ic.claudemesh.com/ws`): autodeployed via Coolify
  off the gitea-vps push. The custom migration runner from earlier
  this session is the one moving migrations forward. No new
  migrations shipped today — all v1.6.x work was code-only against
  the v0.2.0 schema.
- **Web** (`claudemesh.com`): autodeployed via Vercel off the github
  push. Verified `/v1/notifications`, `/v1/peers`, `/v1/members`,
  `/v1/topics/general/stream`, `/v1/topics/general/read` all
  return 401 with bad bearer (i.e. they exist + auth works).
  Authenticated browser smoke not run — no Playwriter session
  available during this handoff write.
- **CLI** (`claudemesh-cli@1.6.1` on npm): unchanged this session.
  All v1.6.x work was server + web only; CLI doesn't yet consume
  the new endpoints.

### CLI gap — worth noting

The new endpoints have NO CLI surface yet:

- `GET /v1/notifications` — `claudemesh notification list` could show
  recent mentions in the terminal. ~30 LoC.
- `GET /v1/members` — `claudemesh member list` shows roster + online
  state. Distinct from `peer list` which shows live sessions.
- `PATCH /v1/topics/:name/read` — could be implicit (called by
  `topic show <name>`) or explicit (`claudemesh topic read <name>`).
- SSE stream — `claudemesh topic tail <name>` would tail messages
  in the terminal. High demo value.

Wiring these is a small CLI release (v1.7.0). Not blocking anything
but worth doing before the recording so the demo includes a
"terminal tail" cut.

---

## Known issues / risks

1. **Mentions notification endpoint depends on plaintext-base64
   ciphertext** that v0.2.0 ships. When per-topic encryption lands
   in v0.3.0, both `GET /v1/notifications` and the universe-page
   `MentionsSection` query break. Migration plan is documented in
   the blog post + the inline comment: move to a
   `mesh.notification` table populated at write time.

2. **Postgres `convert_from(decode(ciphertext, 'base64'), 'UTF8')`
   throws on any ciphertext that isn't valid base64-of-UTF8.** All
   current writers (broker WS path, REST POST /messages, web chat
   panel) emit base64-of-plaintext-UTF8, so this works. If a future
   writer emits binary ciphertext, the mention queries crash. Add a
   safe-base64 guard or migrate to per-write notification table
   before that happens.

3. **No live SSE smoke test in this session.** Endpoints respond
   401 to bad bearer. Browser-authenticated test was deferred — no
   Playwriter session was reachable during the run. Worth a
   manual smoke before recording the demo.

4. **CSRF middleware blocks PATCH/POST without an Origin header.**
   This is correct behaviour but trips up curl users. Documented
   in the smoke notes; not a bug.

---

## Next session — three branches

### A. Record + ship the v1.7.0 launch (~2 hours, all human work)
1. Spin a fresh demo mesh + two iTerm panes running
   `claudemesh launch --name Mou` and `--name Alexis`.
2. Run the demo script in `docs/demo-v1.7.0-script.md`.
3. Cut to 90s, upload to `claudemesh.com/media/demo-v170.mp4`.
4. Take 4-6 screenshots (universe, mesh detail, chat with sidebar,
   mentions feed, mobile view) for the blog hero + Twitter card.
5. Cross-post per the script's distribution checklist.

### B. Wire CLI verbs to v1.6.x endpoints (~3 hours, code)
1. `claudemesh notification list [--since]` → `GET /v1/notifications`.
2. `claudemesh member list` → `GET /v1/members`.
3. `claudemesh topic tail <name>` → SSE consumer. Print as messages
   arrive. Highest demo value.
4. `claudemesh topic read <name>` → `PATCH /v1/topics/:name/read`.
5. Bump `apps/cli/package.json` to 1.7.0, publish.

### C. v0.3.0 first slice — per-topic encryption (~5 hours, code)
This is the next architectural cut.
1. Schema: add `mesh.topic.encrypted_key` (encrypted-to-mesh-root).
2. Broker: derive symmetric key on first message via HKDF; cache.
3. Client: per-topic key fetch + `crypto_secretbox` over body.
4. `ciphertext` column stops being plaintext-base64 → mentions
   query needs the notification table from issue #1.

Highest leverage right now is **A** (the recording is what turns
shipped code into shipped product), then **B** (CLI parity makes
the demo fuller). **C** is the next session for someone with
2+ uninterrupted hours.

---

## Repo state

- `main` ahead of `gitea-vps/main` and `github/main` by 0 commits
  at handoff time — both pushed.
- 12 commits this evening session (sse → unread → grid → sidebar →
  ssefix → mentions → search → notifications → roadmap → humans →
  roadmap2 → blog+demo → timeline).
- No open PRs; everything went to main directly.
- No `.skip` / TODO files / temp commits left behind.

---

*Last handoff: this file. Previous: `2026-05-02-handoff.md` (morning).*
