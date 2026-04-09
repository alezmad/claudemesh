# CLI Auth Sync: Zero-Friction Onboarding

> Spec for syncing dashboard meshes to the CLI without manual join commands.
> Goal: `npm i -g claudemesh-cli && claudemesh launch` — one install, one
> command, even for users who already created meshes on the dashboard.

---

## Problem

Today a user who created a mesh on claudemesh.com must:
1. `npm i -g claudemesh-cli`
2. Go to dashboard → generate invite → copy token
3. `claudemesh join <token>`
4. `claudemesh launch --name Alice`

Steps 2-3 are friction. The dashboard already knows their meshes. The CLI
should sync them automatically.

## Design goal

```bash
npm i -g claudemesh-cli
claudemesh launch --name Alice
```

Two commands total. If the user has meshes on the dashboard, they appear
automatically. If they have none, the CLI walks them through creating one.

**UX principles:**
- **No menus on the happy path.** If the user typed `launch`, they want to
  launch — not answer 7 prompts. Default to browser sync, auto-pick the
  first mesh, default to `push` mode. Everything overridable with flags.
- **Headless fallback.** SSH users can't open a browser. Always provide a
  pairing code + paste-token alternative.
- **Sync anytime.** First-time wizard is not the only entry point. A
  standalone `claudemesh sync` command re-syncs meshes at any time.

---

## Identity model

Two separate auth systems exist today:

| System | Auth method | Where identity lives |
|---|---|---|
| **Dashboard** | Google OAuth (via Payload CMS) | `user` table in Postgres, session cookie |
| **CLI/Broker** | ed25519 keypairs | `~/.claudemesh/config.json` + `mesh.member` table |

These are currently **unlinked**. The broker doesn't know which dashboard
user owns a keypair, and the dashboard doesn't know a CLI user's pubkey.

### Keep them separate

Don't merge them into one auth system. OAuth is for web sessions. Ed25519
is for peer identity and E2E crypto. They serve different purposes.

Instead, **link** them: a dashboard user can claim a CLI keypair, and vice
versa. The link is stored in the DB and used for mesh sync.

---

## Architecture

```
claudemesh launch --name Alice
│
├── 1. Check ~/.claudemesh/config.json
│      Has meshes? → pick one, launch (existing flow)
│
├── 2. No meshes → check for linked dashboard account
│      ~/.claudemesh/config.json has accountId? → fetch meshes from broker
│      Has meshes on broker? → auto-enroll locally, launch
│
├── 3. No linked account → auto-start browser sync
│      Generate 4-char pairing code (e.g. A3Kx)
│      Start localhost callback listener
│      Open browser: https://claudemesh.com/cli-auth?port=<port>&code=<code>
│      Print fallback: "Can't open browser? Visit: <url>"
│      Print fallback: "Or join with invite: claudemesh launch --join <url>"
│
│      Wait for sync token (from localhost redirect or manual paste)
│
└── 4. On sync token received
       ├── Generate ed25519 keypair
       ├── POST /cli-sync → broker creates members, returns mesh list
       ├── Write all meshes + accountId to config
       ├── Auto-select first mesh (or --mesh flag)
       └── Launch immediately (no further prompts)
```

---

## The sync token

A short-lived JWT issued by the dashboard after OAuth, containing:

```json
{
  "sub": "user_abc123",
  "email": "alice@example.com",
  "meshes": [
    { "id": "mesh_xyz", "slug": "dev-team", "role": "admin" },
    { "id": "mesh_abc", "slug": "research", "role": "member" }
  ],
  "action": "sync",        // or "create"
  "newMesh": {              // only if action=create
    "name": "My Team",
    "slug": "my-team"
  },
  "iat": 1712000000,
  "exp": 1712000900         // 15 min TTL
}
```

The CLI never sees the user's OAuth tokens. It only gets this sync token,
which the broker validates and uses to create/find members.

**TTL: 15 minutes** (not 5). First-time users may need to create a Google
account, go through OAuth consent, and create a mesh. The real protection
is single-use JTI dedup, not a tight TTL.

---

## Broker: POST /cli-sync

New endpoint. Accepts a sync token, returns mesh details for each mesh.

```typescript
// Request
POST /cli-sync
{
  "sync_token": "<JWT>",
  "peer_pubkey": "<ed25519 hex>",  // CLI's freshly generated keypair
  "display_name": "Alice"
}

// Response
{
  "ok": true,
  "account_id": "user_abc123",
  "meshes": [
    {
      "mesh_id": "mesh_xyz",
      "slug": "dev-team",
      "broker_url": "wss://ic.claudemesh.com/ws",
      "member_id": "member_123",
      "role": "admin"
    },
    {
      "mesh_id": "mesh_abc",
      "slug": "research",
      "broker_url": "wss://ic.claudemesh.com/ws",
      "member_id": "member_456",
      "role": "member"
    }
  ]
}
```

The broker:
1. Validates the JWT signature and expiry
2. Checks the JTI hasn't been used (in-memory Set, TTL-evicted)
3. For each mesh: creates a `mesh.member` row with the CLI's pubkey (or
   reuses existing if this pubkey is already a member)
4. Links the dashboard `user.id` to the `mesh.member` via a new
   `dashboard_user_id` column
5. Returns mesh details so the CLI can write `config.json`

---

## Web: /cli-auth page

New page at `https://claudemesh.com/cli-auth?port=<port>&code=<code>`.

The `code` param is the 4-char pairing code displayed in the CLI terminal,
shown on the page so the user can confirm they're syncing the right session.

### Flow

1. User lands on the page (already signed in via Google, or signs in now)
2. Page shows their meshes + the pairing code for confirmation:
   ```
   Sync with claudemesh CLI

   Pairing code: A3Kx
   Confirm this matches your terminal.

   Your meshes:
   ☑ dev-team (3 members, admin)
   ☑ research (1 member, member)

   [Sync to CLI]
   ```
3. User clicks "Sync to CLI"
4. Dashboard generates a sync JWT
5. **Redirect attempt**: `http://localhost:<port>/callback?token=<JWT>`
6. **If redirect fails** (port unreachable, headless, different device):
   show the token on-screen with copy button and instructions:
   ```
   Couldn't reach your terminal automatically.
   Copy this token and paste it in your terminal:

   [eyJhbGciOi...] [Copy]
   ```

### Localhost reachability check

Before redirecting, the page does a preflight check:

```javascript
try {
  const res = await fetch(`http://localhost:${port}/ping`, { signal: AbortSignal.timeout(2000) });
  if (res.ok) redirect(`http://localhost:${port}/callback?token=${jwt}`);
  else showManualToken(jwt);
} catch {
  showManualToken(jwt);
}
```

The CLI's callback listener responds to `/ping` with 200 OK (no token needed).

### If user has no meshes

```
   Welcome to claudemesh!

   You don't have any meshes yet. Let's create one.

   Name: [My Team        ]
   Slug: [my-team         ]

   [Create & sync to CLI]
```

Creates the mesh, generates the sync token with the new mesh, redirects.

---

## CLI: localhost listener

Minimal HTTP server, adapted from Claude Code's `AuthCodeListener` pattern:

```typescript
import { createServer } from "node:http";

interface CallbackListener {
  port: number;
  token: Promise<string>;
  close: () => void;
}

function startCallbackListener(): Promise<CallbackListener> {
  return new Promise((resolveStart) => {
    let resolveToken: (token: string) => void;
    const tokenPromise = new Promise<string>((r) => { resolveToken = r; });

    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (url.pathname === "/ping") {
        // Reachability check from the web page
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "https://claudemesh.com",
        });
        res.end("ok");
        return;
      }

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        if (token) {
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Access-Control-Allow-Origin": "https://claudemesh.com",
          });
          res.end(`<html><body>
            <h2>Done! You can close this tab.</h2>
            <p>Launching claudemesh...</p>
          </body></html>`);
          resolveToken(token);
          server.close();
        } else {
          res.writeHead(400);
          res.end("Missing token");
        }
        return;
      }

      // CORS preflight for /ping
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "https://claudemesh.com",
          "Access-Control-Allow-Methods": "GET",
        });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolveStart({
        port: addr.port,
        token: tokenPromise,
        close: () => server.close(),
      });
    });
  });
}
```

---

## CLI: first-time sync flow

In `launch.ts`, when `config.meshes.length === 0`:

```typescript
if (config.meshes.length === 0 && !joinUrl) {
  // Generate pairing code (4 alphanumeric chars)
  const code = generatePairingCode();

  // Start listener
  const listener = await startCallbackListener();
  const action = "sync";
  const url = `https://claudemesh.com/cli-auth?port=${listener.port}&code=${code}&action=${action}`;

  console.log(`
  ${bold("Welcome to claudemesh!")} No meshes found.
  Opening browser to sign in...
  `);

  // Try to open browser (non-fatal if it fails)
  const opened = await openBrowser(url);

  if (!opened) {
    console.log(`  Couldn't open browser automatically.`);
  }

  console.log(`  ${dim(`Visit: ${url}`)}`);
  console.log(`  ${dim(`Or join with invite: claudemesh launch --join <url>`)}`);
  console.log();

  // Race: localhost callback vs manual paste vs timeout
  const syncToken = await Promise.race([
    listener.token,
    askManualToken(),      // "Paste sync token: " prompt (resolves on paste)
    timeout(15 * 60_000),  // 15 min, matches JWT TTL
  ]);

  listener.close();

  if (!syncToken) {
    console.error("  Timed out waiting for sign-in.");
    process.exit(1);
  }

  // Generate keypair and sync with broker
  const keypair = await generateKeypair();
  const result = await syncWithBroker(syncToken, keypair, displayName);

  // Write all meshes to config
  for (const m of result.meshes) {
    config.meshes.push({
      meshId: m.mesh_id,
      memberId: m.member_id,
      slug: m.slug,
      name: m.slug,
      pubkey: keypair.publicKey,
      secretKey: keypair.secretKey,
      brokerUrl: m.broker_url,
      joinedAt: new Date().toISOString(),
    });
  }
  config.accountId = result.account_id;
  saveConfig(config);

  console.log(`  ${green("✓")} Synced ${result.meshes.length} mesh(es): ${result.meshes.map(m => m.slug).join(", ")}`);
}

// Auto-select mesh: first one, or --mesh flag
const mesh = flags.mesh
  ? config.meshes.find(m => m.slug === flags.mesh)
  : config.meshes[0];

if (!mesh) {
  console.error(`Mesh not found: ${flags.mesh}`);
  console.error(`Available: ${config.meshes.map(m => m.slug).join(", ")}`);
  process.exit(1);
}

// Launch immediately with defaults
// Role, groups, messageMode all use flag values or defaults (no prompts)
```

### No prompts on the happy path

| Setting | Default | Override |
|---|---|---|
| Mesh | First in list | `--mesh <slug>` |
| Role | *(none)* | `--role <role>` |
| Groups | *(none)* | `--groups <a,b>` |
| Message mode | `push` | `--message-mode <mode>` |
| Confirmation | Skip on first sync | `-y` for all future launches |

The existing interactive prompts (role, groups, message mode) are kept
for `claudemesh launch` when the user has meshes and runs without flags
and without `--quiet`. But they're **skipped entirely on the first sync
flow** — the user just signed in via browser, that's enough friction.

---

## CLI: `claudemesh sync` command

Standalone command for re-syncing meshes anytime:

```bash
# Sync new meshes from dashboard
claudemesh sync

# Force re-sync (re-link account even if already linked)
claudemesh sync --force
```

```typescript
// commands/sync.ts
export default defineCommand({
  meta: { name: "sync", description: "Sync meshes from your dashboard account" },
  args: {
    force: { type: "boolean", description: "Re-link account even if already linked" },
  },
  async run({ args }) {
    const config = loadConfig();

    // Start browser flow (same as first-time, but action=sync always)
    const code = generatePairingCode();
    const listener = await startCallbackListener();
    const url = `https://claudemesh.com/cli-auth?port=${listener.port}&code=${code}&action=sync`;

    console.log(`Opening browser...`);
    console.log(dim(`Visit: ${url}`));
    await openBrowser(url);

    const syncToken = await Promise.race([
      listener.token,
      askManualToken(),
      timeout(15 * 60_000),
    ]);
    listener.close();

    if (!syncToken) {
      console.error("Timed out.");
      process.exit(1);
    }

    // Use existing keypair from first mesh, or generate new
    const keypair = config.meshes.length > 0
      ? { publicKey: config.meshes[0].pubkey, secretKey: config.meshes[0].secretKey }
      : await generateKeypair();

    const result = await syncWithBroker(syncToken, keypair, config.displayName ?? "unnamed");

    // Merge: add new meshes, skip duplicates
    let added = 0;
    for (const m of result.meshes) {
      if (config.meshes.some(existing => existing.meshId === m.mesh_id)) continue;
      config.meshes.push({
        meshId: m.mesh_id,
        memberId: m.member_id,
        slug: m.slug,
        name: m.slug,
        pubkey: keypair.publicKey,
        secretKey: keypair.secretKey,
        brokerUrl: m.broker_url,
        joinedAt: new Date().toISOString(),
      });
      added++;
    }
    config.accountId = result.account_id;
    saveConfig(config);

    if (added > 0) {
      console.log(green(`✓ Added ${added} new mesh(es)`));
    } else {
      console.log(`Already up to date (${config.meshes.length} meshes)`);
    }
  },
});
```

---

## CLI: openBrowser utility

Cross-platform browser launcher adapted from Claude Code's `utils/browser.ts`:

```typescript
import { exec } from "node:child_process";

export async function openBrowser(url: string): Promise<boolean> {
  // Validate URL
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;

  // Respect BROWSER env var
  const browserCmd = process.env.BROWSER;

  const cmd = browserCmd
    ? `${browserCmd} ${JSON.stringify(url)}`
    : process.platform === "darwin"
      ? `open ${JSON.stringify(url)}`
      : process.platform === "win32"
        ? `rundll32 url.dll,FileProtocolHandler ${JSON.stringify(url)}`
        : `xdg-open ${JSON.stringify(url)}`;

  return new Promise((resolve) => {
    exec(cmd, (err) => resolve(!err));
  });
}
```

---

## CLI: pairing code

Short alphanumeric code for visual confirmation between terminal and browser:

```typescript
function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}
```

Excludes ambiguous characters (0/O, 1/l/I) for readability.

---

## Config extension

```typescript
// state/config.ts
export interface Config {
  version: 1;
  meshes: JoinedMesh[];
  displayName?: string;
  role?: string;
  groups?: GroupEntry[];
  messageMode?: "push" | "inbox" | "off";
  accountId?: string;        // NEW: linked dashboard user ID
}
```

The `accountId` enables future features:
- Re-sync meshes if new ones are created on the dashboard
- Show account email in `claudemesh status`
- Revoke CLI access from the dashboard

---

## DB changes

### Extend `mesh.member`

```sql
ALTER TABLE mesh.member
  ADD COLUMN dashboard_user_id TEXT;  -- links to Payload CMS user.id

CREATE INDEX member_dashboard_user_idx
  ON mesh.member(dashboard_user_id)
  WHERE dashboard_user_id IS NOT NULL;
```

### No new tables needed

The sync token is a JWT — stateless, validated by signature. No DB storage
required. The broker just reads the claims and creates/finds members.

JTI dedup is in-memory (Set with TTL eviction matching the JWT expiry).

---

## Security

| Concern | Mitigation |
|---|---|
| Sync token theft | 15 min TTL, **single-use** (broker tracks used JTIs in memory), localhost-only redirect |
| Localhost port scanning | Random port, CORS restricted to `https://claudemesh.com`, `/ping` only returns "ok" |
| Reachability check spoofing | Pairing code shown on both terminal and web page — user visually confirms match |
| CSRF on /cli-auth | Require existing dashboard session (Google OAuth) |
| Multiple CLI devices | Each generates its own keypair — one dashboard user can have multiple CLI identities |
| Revoking CLI access | Dashboard can delete `mesh.member` rows linked to a `dashboard_user_id` |
| Headless environments | Manual token paste fallback — no browser required |

---

## UX flow: first-time experience

### Happy path (has browser, has meshes)

```
$ npm i -g claudemesh-cli

$ claudemesh launch --name Alice

  Welcome to claudemesh! No meshes found.
  Opening browser to sign in...

  Visit: https://claudemesh.com/cli-auth?port=54321&code=A3Kx
  Or join with invite: claudemesh launch --join <url>

  ⣾ Waiting...

  ✓ Synced 2 mesh(es): dev-team, research
  Launching on dev-team (use --mesh to change)

claudemesh launch — as Alice on dev-team [push]
────────────────────────────────────────────────────────────

  Launching...
```

### Headless path (SSH, no browser)

```
$ claudemesh launch --name Alice

  Welcome to claudemesh! No meshes found.
  Opening browser to sign in...

  Couldn't open browser automatically.
  Visit: https://claudemesh.com/cli-auth?port=54321&code=A3Kx
  Or join with invite: claudemesh launch --join <url>

  Paste sync token: eyJhbGciOi...█

  ✓ Synced 1 mesh(es): dev-team

claudemesh launch — as Alice on dev-team [push]
```

### No meshes on dashboard

Browser shows "Create a mesh" form. User creates one. Redirects back.

```
  ✓ Synced 1 mesh(es): my-team (just created)
```

### Second launch (instant, no prompts)

```
$ claudemesh launch --name Alice

claudemesh launch — as Alice on dev-team [push]
────────────────────────────────────────────────────────────

  Launching...
```

### Customized launch

```
$ claudemesh launch --name Alice --mesh research --role lead --groups eng,review --message-mode inbox

claudemesh launch — as Alice (lead) on research [@eng:lead, @review] [inbox]
```

---

## Implementation order

1. **Broker:** `POST /cli-sync` endpoint — validate JWT, JTI dedup, create/find members, return mesh list
2. **DB:** Add `dashboard_user_id` to `mesh.member`
3. **Web:** `/cli-auth` page — OAuth gate, mesh picker, pairing code display, sync token generation, localhost preflight + redirect, manual token fallback
4. **CLI:** `startCallbackListener()` — localhost HTTP server with `/ping` and `/callback`
5. **CLI:** `openBrowser()` — cross-platform browser opener
6. **CLI:** First-time sync flow in `launch.ts` — no-prompt happy path with race (callback vs paste vs timeout)
7. **CLI:** `claudemesh sync` command — standalone re-sync
8. **Config:** Add `accountId` field

---

## What stays the same

- `claudemesh join <url>` still works — for users who receive invite links
- `claudemesh launch --join <url>` still works — join + launch in one step
- Ed25519 keypairs remain the mesh identity — OAuth is only for sync
- The broker never sees OAuth tokens — only the sync JWT
- Existing users with local meshes are unaffected — sync flow only triggers when `config.meshes` is empty
- Interactive prompts (role, groups, mode) still work on subsequent launches without flags

---

## Related specs

- **[Member Profile](member-profile-spec.md)** — Persistent identity
  (role tag, groups, message mode) on the member row, dashboard
  management, self-edit permissions, invite presets. The sync spec gets
  users into the mesh; the member profile spec defines who they are
  once they're in.

---

## Open questions

1. **Shared keypair across meshes?** Current spec generates one keypair and
   uses it for all synced meshes. Simpler, but means revoking one mesh
   doesn't rotate the key for others. Alternative: one keypair per mesh
   (more isolation, more config complexity). **Decision: shared for v1.**

2. **`claudemesh sync --auto`?** Could auto-sync on every `launch` if
   `accountId` is set (hit broker, check for new meshes). Adds latency to
   every launch. **Decision: not in v1. Manual `claudemesh sync` only.**
