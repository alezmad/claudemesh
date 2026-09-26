# Session identity & routing hardening (CLI 1.38.0)

Source: flexicar-orchestrator bug report 2026-09-26 (9 bugs, CLI 1.37.0) + user report
"peers spread messages to the wrong peers, creates noise in context". Investigated at `59610b5`.

## Root thread
The member key is used where a session key belongs, at three points that feed each other:
1. a session that lost its daemon registration silently signs sends with the **member** key;
2. the channel notification exposes `from_pubkey` = member key, so the receiver replies to the member;
3. the broker delivers a member-key DM to *any/every* connection of that member.
Result: replies fan out to sibling sessions → noise. Fix all three; each alone is insufficient.

## Decisions (per bug, ordered by blast radius)

### §1 bug2 — never inject undecryptable bytes
- `daemon/inbound.ts`: base64 "plaintext" fallback only when the push is **not** a sealed DM
  (no `nonce`+`senderPubkey`), decoded with `TextDecoder("utf-8",{fatal:true})`.
- A sealed payload that fails every key → body `null`. If `topic` is known → render placeholder
  `[encrypted #<topic> message — claudemesh topic tail <topic>]`; otherwise **drop**: log
  `inbound_decrypt_failed {broker_message_id, sender}`, ack (stop redelivery), no inbox row, no bus event.
- MCP (`mcp/server.ts`) second guard: never emit a channel body containing U+FFFD or C0 controls
  (except \t\n\r).
- Broker drained push (`index.ts maybePushQueuedMessages`) carries `senderName`,
  `senderMemberPubkey`, `topic`, `subtype` like the live push already does.
- Deferred (own feature, not effort): daemon-side v2 topic decrypt needs a REST key mint per topic
  in the daemon hot path; placeholder is honest until then.

### §2 bug1 — no silent member-key identity
- `ipc/server.ts`: a request carrying a session header that doesn't resolve → **401 session_unknown**
  (not a silent `session=null`).
- `send`: when the process is inside a launched session (`CLAUDEMESH_SESSION_ID` set) but the
  daemon doesn't know the session → error with fix hint, unless `--as-member`.
- Re-attach (implemented client-side over the existing `POST /v1/sessions/register`, no new route):
  `services/session/reattach.ts ensureSessionRegistered` loads the session's persisted keypair,
  signs a fresh attestation with the member key and registers with **claude's pid** (nearest
  `claude` ancestor). Called by the MCP at startup (always, to move the anchor off the wrapper),
  by `claudemesh send` when the session is unknown (auto-heal), and by `claudemesh session reattach`.
- `send` inside a session (`CLAUDEMESH_SESSION_ID` set) that can't be re-attached refuses unless
  `--as-member`; the daemon answers 401 `session_unknown` to a send whose session token it doesn't know.
- Token lives in a stable per-session path (`~/.claudemesh/sessions/<mesh>/<stem>.token`), not the
  launch tmpdir, so a resumed claude finds it; token readers fall back to it via
  `CLAUDEMESH_SESSION_ID` (+ new `CLAUDEMESH_MESH_SLUG`, or the mesh holding the keypair file).
- The 24 h absolute cap is removed for entries whose pid+start-time still match.
- Tokenless MCP subscribes to **no** message events (today: all of them).

### §3 wrong-peer delivery
- Broker: a DM whose target is a member pubkey of a member with ≥1 live session is rejected
  `member_target_requires_fanout` unless the envelope sets `fanout:true`. Rollout: log-only via
  env `CLAUDEMESH_MEMBER_DM_POLICY=warn` (default), `reject` after one release.
- CLI `send`: refuses a member-key target (other member) unless `--fanout`.
- Channel meta: `from_pubkey`/`from_id` = sender **session** pubkey; new `from_member_pubkey`.
  Skill text updated: reply to `from_pubkey`.
- Name / prefix resolution (daemon + cold path): >1 match → error listing candidates; control-plane
  rows and member keys excluded.
- `--self`: requires a registered session; scoped to the current mesh.
- Inbox dedupe key = (client_message_id, recipient_pubkey).

### §4 bug3 — keys don't change behind a session's back
- `launch`: mint the UUID first; the same id drives keypair + registration; no throwaway keypair
  when a session id exists (non-UUID ids persisted under sha256).
- Boot reload: load-only; a missing key file → skip + log, never mint.
- ~~Supervisor that rebuilds a `replaced` session client~~ — **dropped during implementation.**
  1.37.1 made `session_replaced` terminal on purpose (two daemons holding one identity kicked each
  other at 1 s, 2026-09-08 drill). With keys no longer re-minted (reload is load-only, one id per
  launch, non-UUID ids persisted) the only replacer is the session's own re-register, which already
  swaps the client. A supervisor would re-open that ping-pong for no gain.
- Same-token + same-key re-register only moves the pid anchor (no hooks → no WS close/reopen).
- The registry's absolute 24 h TTL is removed; liveness = pid + start time.

### §5 bug4 — shipped in `dd351a7` (1.37.1, unpublished) — releases with 1.38.0.

### §6 the rest
- bug5 `topic history` decrypts via the same topic-key path as `tail` (shared `decryptForRender`).
- bug6 author label: history/tail return the session pubkey + a `sender_display_name` captured at write.
- bug7 non-TTY confirm → exit non-zero with `--yes` hint; `[-y]` in kick/ban/disconnect help.
- bug8 `message status` matches broker id OR `client_message_id` (hyphens ignored).
- bug9 `send` to a control-plane row says so (not "ephemeral"); `peer list --all` tags control-plane.

## Smoke tests
| case | expected |
|---|---|
| push with sealed DM + wrong key | no inbox row, no channel event, `inbound_decrypt_failed` logged, acked |
| broadcast base64 of invalid UTF-8 | dropped, not rendered |
| resumed session (`claude --resume`) | same session pubkey, sends signed by session key |
| DM to a member pubkey (policy reject) | broker error `member_target_requires_fanout` |
| reply via channel `from_pubkey` | lands in exactly one session |
| `message status <8 chars printed by send>` | resolves |
