# CLI Auth — Device Code Flow + Personal Access Tokens

**Status:** spec
**Created:** 2026-04-10
**Owner:** CLI-Dev (implementation), Orchestrator (spec)
**Target version:** v0.11.0
**Related:** `2026-04-10-anthropic-vision-meshes-invites.md`, `2026-04-10-cli-wizard-architecture-refactor.md`

## Goal

The CLI is a first-class client. From a fresh terminal, with zero prior browser interaction, a user can:

```
claudemesh login                          # device-code OAuth, browser handshake
claudemesh create "Platform team"          # creates real mesh via /api/my/meshes
claudemesh invite --email alice@x.com      # generates invite, sends email
claudemesh launch --mesh platform-team -y  # spawns Claude Code in the mesh
```

For CI / scripting / non-interactive contexts, PAT works too:

```
claudemesh login --token cm_pat_abc123
claudemesh create "CI test mesh" --json | jq .id
```

This is the auth substrate that unblocks the "Anthropic vision" — every other dashboard-only feature (meshes, invites, members, billing) becomes CLI-accessible after this lands.

## Non-goals

- SSO / SAML / enterprise IdP integration (later, post-1.0)
- Refresh tokens with rotation (long-lived API keys are sufficient for v1)
- Multi-account switching (one logged-in identity per `~/.claudemesh/auth.json`)
- Device fleet management UI (single "revoke" button per token is enough for v1)

## Auth model overview

Two coexisting credential types, both backed by **Better Auth's `apiKey` plugin**:

| Type | Created via | Lifetime | Use case | Storage |
|---|---|---|---|---|
| **Device-code session token** | `claudemesh login` (OAuth-style browser handshake) | 90 days, auto-renew on use | Interactive humans on their workstation | `~/.claudemesh/auth.json` |
| **Personal access token (PAT)** | Dashboard → Settings → CLI tokens → Generate | User-chosen (30d / 90d / 1y / never), explicit revocation | CI, scripts, automation, server-side cron | Anywhere the user puts it; CLI reads from `--token` flag, env var, or `auth.json` |

Both flow through the same `Authorization: Bearer cm_<type>_<random>` header. The API doesn't care which one it gets — it just validates against the `api_key` table.

**Token format:**
- `cm_session_<32-byte base32>` — device-code sessions
- `cm_pat_<32-byte base32>` — personal access tokens

The `cm_` prefix lets us scan for leaked tokens with regex (e.g. GitHub secret scanning, internal scripts). The middle segment (`session` / `pat`) is for human readability in token lists, not for security.

## User flows

### 1. First-time login (interactive happy path)

```
$ claudemesh login

  ██  claudemesh login

  Opening browser for authentication…

  If your browser didn't open, visit:
    https://claudemesh.com/cli-auth?code=ABCD-EFGH

  Enter this code:
    ABCD-EFGH

  Waiting for confirmation… ⠋
```

In the browser:
1. User lands on `/cli-auth?code=ABCD-EFGH`
2. If not signed in, Better Auth login screen appears, then redirects back
3. User sees a confirmation card:
   ```
   Link this CLI session?
   Code: ABCD-EFGH
   Device: Alejandro's MacBook Pro · darwin · arm64
   Expires in 9:47
   [Approve] [Deny]
   ```
4. User clicks Approve

CLI polls every 1.5s, sees `approved`, receives token, writes `~/.claudemesh/auth.json` with `0600`, prints:

```
  ✔ Authenticated as Alejandro Gutiérrez
  ✔ Token saved to ~/.claudemesh/auth.json
  ✔ Synced 3 meshes: alexis-mou, dev, claudefarm

  Run claudemesh --help to get started.
```

### 2. First-time login (PAT, non-interactive)

```
$ claudemesh login --token cm_pat_abc123def456...
  ✔ Authenticated as Alejandro Gutiérrez (via PAT "ci-deploy")
  ✔ Token saved to ~/.claudemesh/auth.json
```

Or one-shot, no save:

```
$ CLAUDEMESH_TOKEN=cm_pat_abc123 claudemesh create "test"
```

### 3. Already logged in, runs a command

```
$ claudemesh create "Platform team"
  ✔ Created mesh platform-team (id: q5RI89Fl…)
  ✔ Joined locally
  ▸ Invite peers: claudemesh invite --mesh platform-team
```

No auth prompt — token in `auth.json` is used silently.

### 4. Token expired or revoked

```
$ claudemesh peers
  ✘ Authentication failed (token expired or revoked)

  Run claudemesh login to re-authenticate.
```

Exit code `2`. The `auth.json` is **not** auto-deleted (user might be debugging) but the next `claudemesh login` overwrites it cleanly.

### 5. Wizard launch flow with auth integration

When `claudemesh` (bare, no auth) is run:

```
  ██  claudemesh

  ▸ Sign in (opens browser)
    Paste a personal access token
    Join a mesh via invite URL
    Exit
```

After auth completes, the wizard transitions naturally into the launch flow (mesh picker → name → role → confirm → handoff). One uninterrupted experience from "fresh install" to "Claude Code in a mesh."

### 6. CI / non-interactive

```
# .github/workflows/test.yml
- run: |
    claudemesh login --token ${{ secrets.CLAUDEMESH_PAT }}
    claudemesh create "CI run $GITHUB_RUN_ID" --json > mesh.json
```

Or zero-state:

```
- env:
    CLAUDEMESH_TOKEN: ${{ secrets.CLAUDEMESH_PAT }}
  run: claudemesh create "CI run $GITHUB_RUN_ID" --json
```

Token resolution order: `--token` flag > `CLAUDEMESH_TOKEN` env var > `~/.claudemesh/auth.json`.

### 7. Logout

```
$ claudemesh logout
  ✔ Token revoked on server
  ✔ Removed ~/.claudemesh/auth.json
```

`logout` calls `DELETE /api/my/cli/sessions/current` to revoke server-side, then unlinks the local file. Best-effort: if the server call fails, still delete locally and warn.

## Architecture

### Backend — Better Auth `apiKey` plugin

Better Auth ships an `apiKey` plugin that handles:
- Token generation (cryptographically random)
- Hashed storage (only the hash hits the DB; raw token never persisted)
- Verification middleware (validates `Authorization: Bearer …`)
- Per-token metadata (name, scopes, expiry, last-used)
- Per-token revocation

We use it for both PAT and device-code sessions. Device-code sessions just have a marker in metadata distinguishing them from user-generated PATs.

**Wire-up:** `apps/web/src/lib/auth/index.ts` (or wherever Better Auth is initialized) adds:

```ts
import { apiKey } from "better-auth/plugins";

export const auth = betterAuth({
  // …existing config
  plugins: [
    // …
    apiKey({
      enableMetadata: true,
      apiKeyHeaders: ["x-api-key", "authorization"],
      defaultPrefix: "cm_",
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 100 },
    }),
  ],
});
```

### Backend — device-code table

The `apiKey` plugin doesn't ship device-code flow out of the box. We add a small table + 4 endpoints on top.

```sql
-- packages/db/migrations/0020_cli-device-code.sql
CREATE TABLE cli_device_code (
  device_code      text PRIMARY KEY,             -- opaque random, sent to CLI
  user_code        text UNIQUE NOT NULL,         -- short human code: "ABCD-EFGH"
  user_id          text REFERENCES "user"(id),   -- nullable until approved
  api_key_id       text REFERENCES api_key(id),  -- the issued token, set on approve
  device_name      text NOT NULL,                -- "Alejandro's MacBook Pro"
  device_os        text NOT NULL,                -- "darwin"
  device_arch      text NOT NULL,                -- "arm64"
  ip_address       text,                         -- for audit
  user_agent       text,
  status           text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied' | 'expired'
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,         -- created_at + 10 min
  approved_at      timestamptz
);

CREATE INDEX cli_device_code_user_code_idx ON cli_device_code(user_code);
CREATE INDEX cli_device_code_status_expires_idx ON cli_device_code(status, expires_at);
```

A scheduled job (or lazy cleanup on insert) deletes rows where `status='expired'` AND `expires_at < now() - interval '7 days'`.

### Backend — endpoints

All under `apps/web/src/app/api/auth/cli/` (or wherever you keep public auth routes — these need to be **unauthed** since the CLI has no token yet).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/cli/device-code` | none | CLI requests a new device code. Body: `{ device_name, device_os, device_arch }`. Returns `{ device_code, user_code, expires_at, verification_url }`. |
| `GET` | `/api/auth/cli/device-code/:device_code` | none | CLI polls for status. Returns `{ status: 'pending'|'approved'|'denied'|'expired', token?: string, user?: { id, name, email } }`. Token only present when status=approved, and only **once** (subsequent polls return approved without token). |
| `POST` | `/api/auth/cli/device-code/:user_code/approve` | session | Browser confirms. Creates an `api_key` row with metadata `{ kind: 'session', device_name, device_code }`, sets `cli_device_code.api_key_id`, status=approved. |
| `POST` | `/api/auth/cli/device-code/:user_code/deny` | session | Browser denies. Sets status=denied. |

Authed endpoints (under `/api/my/cli/`):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/my/cli/sessions` | List active CLI sessions for the user (devices, last seen, created). |
| `DELETE` | `/api/my/cli/sessions/:id` | Revoke a specific session. |
| `POST` | `/api/my/cli/tokens` | Create a PAT. Body: `{ name, expires_in_days?, scopes? }`. Returns the raw token **once**. |
| `GET` | `/api/my/cli/tokens` | List PATs (no raw values, just metadata). |
| `DELETE` | `/api/my/cli/tokens/:id` | Revoke a PAT. |

### Backend — middleware

Existing `enforceAuth` (in `packages/api/src/utils/`) currently reads cookies. Extend it to also accept `Authorization: Bearer cm_…`:

```ts
export async function enforceAuth(ctx) {
  const bearer = ctx.req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (bearer?.startsWith("cm_")) {
    const result = await auth.api.verifyApiKey({ key: bearer });
    if (result.valid) {
      // record last_used_at, increment usage counter
      return { user: result.user, via: "apiKey", apiKey: result.apiKey };
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid token" });
  }
  // …existing cookie-based auth
}
```

The `apiKey` plugin handles `last_used_at` updates automatically.

### Backend — web route

`apps/web/src/app/[locale]/cli-auth/page.tsx`:

- Reads `?code=ABCD-EFGH` from query string
- If no session, redirects to `/login?next=/cli-auth?code=ABCD-EFGH`
- If session, fetches device code metadata via server component, renders confirmation card
- Approve button → `POST /api/auth/cli/device-code/:user_code/approve`
- Deny button → `POST /api/auth/cli/device-code/:user_code/deny`
- After approve, shows: "✓ CLI authenticated. Return to your terminal."

Mobile-friendly. Confirmation card shows device fingerprint so the user can verify they're approving the right session.

### Backend — dashboard PAT UI

`apps/web/src/app/[locale]/dashboard/settings/cli-tokens/page.tsx`:

- List of existing PATs (name, created, last used, expires)
- "Generate new token" button → modal with name + expiry picker
- After creation, show raw token once with copy button + warning ("This token will not be shown again")
- Per-row revoke button

Reuses existing dashboard layout. Should be ~150 lines including the modal.

### CLI — file layout

```
apps/cli/src/
├── commands/
│   ├── login.ts            # NEW
│   ├── logout.ts           # NEW
│   ├── whoami.ts           # NEW
│   ├── create.ts           # rewrite to call API
│   ├── invite.ts           # NEW
│   ├── sync.ts             # rewrite to call API
│   └── …existing
└── lib/
    ├── auth-store.ts       # NEW: read/write ~/.claudemesh/auth.json
    ├── api-client.ts       # NEW: typed fetch wrapper
    ├── device-info.ts      # NEW: collect hostname, os, arch for device-code request
    └── …existing
```

### CLI — `auth-store.ts`

```ts
// ~/.claudemesh/auth.json
type AuthFile = {
  version: 1;
  token: string;            // cm_session_… or cm_pat_…
  user: { id: string; name: string; email: string };
  created_at: string;       // ISO
  source: "device-code" | "pat" | "env";
};
```

Read priority: `--token` flag > `CLAUDEMESH_TOKEN` env > `auth.json`.
Write only on `login` success. File mode `0600`. Parent dir `0700`.
On read, if file mode is too permissive, log a warning and continue.

### CLI — `api-client.ts`

Thin wrapper over `fetch`:

```ts
export class ClaudemeshApi {
  constructor(private opts: { baseUrl: string; token: string }) {}

  async createMesh(input: { name: string; slug?: string }) { … }
  async listMeshes() { … }
  async createInvite(input: { meshId: string; email?: string; role?: string }) { … }
  async listSessions() { … }
  async revokeSession(id: string) { … }
  async whoami() { … }
}
```

Type definitions live in `packages/api/src/contracts/cli.ts` (new file) — generated from the existing tRPC routers as plain types so the CLI doesn't need to import the whole tRPC client.

Base URL from `CLAUDEMESH_API_URL` env var, defaults to `https://claudemesh.com`. Allows local dev against `http://localhost:3000`.

### CLI — device-code login flow

```ts
// commands/login.ts
async function deviceCodeLogin() {
  const device = collectDeviceInfo();
  const { device_code, user_code, expires_at, verification_url } =
    await api.requestDeviceCode(device);

  console.log(`  Opening ${verification_url}…`);
  console.log(`  Code: ${user_code}`);

  await openBrowser(`${verification_url}?code=${user_code}`);

  const spinner = ora("Waiting for confirmation").start();
  const deadline = new Date(expires_at).getTime();

  while (Date.now() < deadline) {
    await sleep(1500);
    const result = await api.pollDeviceCode(device_code);
    if (result.status === "approved") {
      spinner.succeed("Authenticated");
      await authStore.write({ token: result.token, user: result.user, source: "device-code" });
      await syncMeshes();
      return;
    }
    if (result.status === "denied") {
      spinner.fail("Denied in browser");
      process.exit(1);
    }
  }
  spinner.fail("Timed out");
  process.exit(1);
}
```

Polls every 1.5s. Server returns `{ slow_down: true }` if polled too fast (rate limit at 1/sec).

## Security

1. **Tokens are hashed at rest** (Better Auth `apiKey` plugin handles this with bcrypt or argon2).
2. **Raw tokens shown to user once.** PATs in dashboard, device-code tokens via `claudemesh login` output. Never logged, never re-displayable.
3. **`auth.json` is `0600`.** CLI refuses to write if parent dir can't be made `0700`. Warns on read if mode is wider.
4. **Token prefix `cm_` enables secret scanning.** Document the regex `cm_(session|pat)_[a-z0-9]{32,}` in security docs so GitHub secret scanning, GitGuardian, etc. can detect leaks.
5. **`/api/auth/cli/device-code/:device_code` polling is rate-limited** to 1 req/sec per IP per device_code. Returns `429` with `slow_down: true` body.
6. **Device codes expire in 10 minutes.** Approved-but-unclaimed tokens stay valid (the polling endpoint still returns the token for 60 seconds after approval, then the device_code row is GC'd).
7. **Audit logging.** Every device-code approval, PAT creation, and PAT revocation emits an audit event (`auth.cli.session.created`, `auth.cli.pat.created`, etc.). Stored in existing audit log if there is one, otherwise new `audit_log` table.
8. **Session invalidation on password change.** When a user changes their password via Better Auth, all `cli_session` `api_key` rows for that user are revoked. PATs are NOT auto-revoked (they're explicitly user-managed).
9. **Token revocation is immediate.** `auth.api.verifyApiKey` checks DB on every request — no in-memory cache.
10. **No CSRF concern** for device-code endpoints — the unauthed ones don't act on user state, the authed ones use Better Auth's existing CSRF protection.

## Wizard UX integration

The current welcome wizard already has:
```
▸ Create account (new to claudemesh)
  Sign in (existing account)
  Paste an invite URL
  Exit
```

After this spec lands, the welcome screen becomes:
```
  ██  claudemesh

  ▸ Sign in            ← device-code OAuth
    Paste an access token   ← PAT path
    Join via invite URL     ← unchanged
    Create account          ← opens /register, then back to login
    Exit
```

"Sign in" becomes the headline option. The current "Create account" still opens browser to `/register` but flows back through the device-code handshake instead of a custom callback.

Once authenticated, the wizard transitions to:
```
  ██  claudemesh launch

  Account    ✔  Alejandro Gutiérrez
  Mesh       ▸  (pick one — 3 available)
  Name       ✔  Alexis (from --name)
  Role       ▸  (pick one)

  ▸ Continue
    Cancel
```

Status rows show what's filled and what's left. Mesh picker fetches from `GET /api/my/meshes` via the freshly minted token.

This integrates cleanly with the wizard architecture refactor in `2026-04-10-cli-wizard-architecture-refactor.md`: auth becomes one screen in the launch flow with `isComplete: s => s.user !== null`. On a fresh machine the auth screen runs; on a returning machine it's auto-skipped.

## Error handling

| Scenario | Behavior |
|---|---|
| Browser doesn't open | Print URL prominently, keep polling |
| Network down during poll | Retry with exponential backoff (1.5s → 3s → 6s, max 30s) |
| Device code expires | Print "Login timed out, run `claudemesh login` to retry", exit 1 |
| Token rejected by API | Print "Authentication failed", suggest `claudemesh login`, exit 2 |
| `auth.json` corrupted | Print "Auth file corrupted, run `claudemesh login`", exit 2 |
| `auth.json` permissions wrong | Warn, fix to `0600`, continue |
| PAT pasted to `--token` is malformed | Print "Invalid token format (expected `cm_pat_…`)", exit 1 |
| PAT pasted to `--token` is valid format but unknown | API returns 401, print "Token rejected", exit 2 |
| Two CLI instances poll simultaneously | Both get the same approved status; first to read gets the token, second gets `{ status: 'approved', token: null }` (already_claimed). Document this. |
| User clicks Approve in browser, then closes tab | CLI's poll catches it, login succeeds. The browser tab closure is irrelevant. |
| User completes login on machine A, then runs `claudemesh login` on machine B with same account | Both sessions coexist as separate `api_key` rows. `claudemesh whoami --sessions` shows both. |

## Implementation phases

Each phase ships independently and is independently testable.

### Phase 1 — Backend foundation (4–6 hours)

- [ ] Wire Better Auth `apiKey` plugin in `apps/web/src/lib/auth/`
- [ ] Migration `0020_cli-device-code.sql`
- [ ] Drizzle schema for `cli_device_code` in `packages/db/src/schema/auth.ts`
- [ ] Endpoints: `POST /api/auth/cli/device-code`, `GET /api/auth/cli/device-code/:device_code`, `POST /api/auth/cli/device-code/:user_code/approve`, `POST /api/auth/cli/device-code/:user_code/deny`
- [ ] Extend `enforceAuth` middleware to accept `Authorization: Bearer cm_…`
- [ ] Endpoints: `POST /api/my/cli/tokens`, `GET /api/my/cli/tokens`, `DELETE /api/my/cli/tokens/:id`, `GET /api/my/cli/sessions`, `DELETE /api/my/cli/sessions/:id`
- [ ] Unit tests for token verification and device-code state machine

### Phase 2 — Web routes (3–4 hours)

- [ ] `/cli-auth?code=...` page (server component + approve/deny client component)
- [ ] `/dashboard/settings/cli-tokens` page (list + create modal + revoke)
- [ ] Translations for both pages (en, es)
- [ ] E2E test: full device-code happy path with Playwright

### Phase 3 — CLI auth core (4–5 hours)

- [ ] `lib/device-info.ts` — collect hostname, os, arch
- [ ] `lib/auth-store.ts` — read/write `~/.claudemesh/auth.json` with mode checks
- [ ] `lib/api-client.ts` — typed fetch wrapper with bearer header
- [ ] `commands/login.ts` — device-code flow + `--token` PAT path
- [ ] `commands/logout.ts` — revoke + delete local
- [ ] `commands/whoami.ts` — print current identity + token source
- [ ] Token resolution helper (`--token` > `CLAUDEMESH_TOKEN` > `auth.json`)
- [ ] Unit tests for auth-store and token resolution

### Phase 4 — CLI commands wired to API (3–4 hours)

- [ ] Rewrite `commands/create.ts` to call `POST /api/my/meshes`
- [ ] New `commands/invite.ts` with `--email`, `--mesh`, `--role`, `--expires-in`
- [ ] Rewrite `commands/sync.ts` to call `GET /api/my/meshes` and reconcile local config
- [ ] Update `commands/list.ts` to show server-side meshes too
- [ ] Integration tests against staging broker + web

### Phase 5 — Wizard integration (3–4 hours)

- [ ] Welcome screen new options (Sign in / Paste token / Create account / Join invite)
- [ ] Auth screen as a flow step with `isComplete: s => s.user !== null`
- [ ] Status rows pattern showing auth state during launch
- [ ] First-run detection (no `auth.json`) → auto-route to login

### Phase 6 — Polish, docs, ship (2–3 hours)

- [ ] Update `README.md`, `apps/cli/README.md`, `docs/quickstart.md`
- [ ] CHANGELOG entry for v0.11.0
- [ ] Telemetry events for `auth.cli.login.{start,success,fail}`
- [ ] Bump `apps/cli/package.json` to `0.11.0`
- [ ] Publish to npm
- [ ] Deploy broker / web (no broker changes, web for new routes)

**Total estimate:** 19–26 hours of focused work. Realistic: 3–4 days with testing and review.

## Dependencies between phases

```
Phase 1 (backend) ──┬─→ Phase 2 (web routes)
                    └─→ Phase 3 (CLI auth core)
                              │
                              └─→ Phase 4 (commands)
                                        │
                                        └─→ Phase 5 (wizard)
                                                  │
                                                  └─→ Phase 6 (ship)
```

Phase 1 and 2 can be parallelized after the schema lands. Phase 3 needs Phase 1 endpoints live (even if on staging). Phase 4 onwards is strictly serial.

## Telemetry

Emit these events (PostHog or whatever the existing analytics are):

- `cli.login.started` — properties: `{ method: 'device-code' | 'pat' }`
- `cli.login.succeeded` — properties: `{ method, user_id }`
- `cli.login.failed` — properties: `{ method, reason }`
- `cli.logout` — properties: `{ user_id }`
- `cli.command.executed` — properties: `{ command, exit_code, duration_ms, authenticated: boolean }`
- `cli.api.error` — properties: `{ endpoint, status, error_code }`

Telemetry is **opt-out**. First run shows a one-line notice: "claudemesh collects anonymized usage telemetry. Disable with `claudemesh telemetry off`."

## Open questions

1. **Better Auth `apiKey` plugin version** — confirm it's installed and at a version that supports `enableMetadata`. Check `pnpm why better-auth` in `apps/web`.
2. **Audit log table** — does one already exist? If not, this spec adds three rows of log; not worth a new table for that. Use `console.log` with structured JSON to stderr and let the platform's log collector handle it.
3. **Email sending** — `claudemesh invite --email` requires a transactional email path. Does the web app already have one (Resend, Postmark)? If yes, reuse. If no, defer the email send to a follow-up; the invite command can still create the invite and print the URL.
4. **Token scopes** — v1 ships with no scopes; every token has full account access. Should we add `mesh:read`, `mesh:write`, `invite:create` scopes from day one, or wait? **Recommendation:** wait. YAGNI. Add when a user actually wants a read-only CI token.
5. **PAT expiry default** — 90 days? 1 year? Never? Better Auth supports all three. **Recommendation:** 1 year default, user can pick "never" with explicit warning.
6. **Mesh slug uniqueness in `claudemesh create`** — what happens if two users try to create meshes with the same slug? Existing API behavior should be tested. If it errors, the CLI should suggest `--slug platform-team-2`.
7. **`claudemesh login` when already logged in** — re-authenticate (overwrite) or error ("already logged in, run logout first")? **Recommendation:** re-authenticate silently with a one-line notice ("Replacing existing session for Alejandro").

## Acceptance criteria

For v0.11.0 to ship, all of these must be true:

- [ ] `claudemesh login` on a fresh machine (no `auth.json`) opens browser, completes device-code flow, writes `auth.json`, runs in <30 seconds end-to-end
- [ ] `claudemesh login --token cm_pat_…` works without browser
- [ ] `claudemesh logout` revokes server-side and deletes local file
- [ ] `claudemesh whoami` prints user identity and token source
- [ ] `claudemesh create "Test mesh"` creates a real mesh on the server, joins it locally, and the user can see it on the dashboard
- [ ] `claudemesh invite --email a@b.c --mesh test` creates an invite and prints the URL
- [ ] `claudemesh launch` (bare) on a fresh machine walks login → mesh picker → name/role → Claude Code, all in one wizard
- [ ] Dashboard `/dashboard/settings/cli-tokens` lists, creates, and revokes PATs
- [ ] All flows work in `en` and `es`
- [ ] Existing `claudemesh launch` invocations (with token already in `auth.json`) still work without prompting
- [ ] Token in `auth.json` survives an hour of idle and continues to work (no aggressive expiry)
- [ ] Revoking a token in the dashboard makes the next CLI call fail with a clear error
- [ ] Documentation updated in `README.md`, `apps/cli/README.md`, `docs/quickstart.md`
- [ ] CHANGELOG entry written
- [ ] Published to npm as `claudemesh-cli@0.11.0`

## What this unlocks

Once this lands, every dashboard-only feature becomes one CLI command away. Future specs that depend on this:

- `claudemesh members list` / `claudemesh members add`
- `claudemesh billing usage`
- `claudemesh mesh archive`
- `claudemesh stream subscribe` (live broker events)
- `claudemesh skill publish` (publish a skill to mesh registry)
- `claudemesh log tail` (mesh-wide audit log)

This is the foundational unlock. Everything else is incremental on top.
