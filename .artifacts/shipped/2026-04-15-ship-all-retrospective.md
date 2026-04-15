# Ship-All Session — 2026-04-15

Full checklist from the "Claude Code-grade CLI" bar, shipped end-to-end.

## Final scoreboard (vs original 15-item list)

| # | Item | Status | Ref |
|---|------|--------|-----|
| 1 | Single static binary, curl-installable, Homebrew, winget | ✅ **Shipped** | `release-cli.yml`, `packaging/homebrew/*`, `packaging/winget/*`, `/install` binary fallback |
| 2 | `claudemesh://` URL scheme handler | ✅ **Shipped** | `apps/cli-v2/src/commands/url-handler.ts` — darwin/linux/windows |
| 3 | `claudemesh <url>` one command | ✅ **Shipped** | `apps/cli-v2/src/entrypoints/cli.ts` bare dispatch |
| 4 | `-y` fully non-interactive | ✅ **Shipped** | `launch.ts` — bypasses wizard |
| 5 | Unified onboarding | ✅ **Shipped** | `welcome.ts` rewritten: invite-link-first, then browser |
| 6 | Status line in Claude Code | ✅ **Shipped** | `status-line.ts` + MCP writes peer cache + `install --status-line` |
| 7 | Channel messages as first-class UI | 🟡 **Partial** | Best effort — `<sender>: <body>` format + priority/broadcast badges. True rich UI requires Claude Code protocol change we don't own. |
| 8 | Recovery phrase / encrypted backup | ✅ **Shipped** | `backup.ts` — Argon2id + XChaCha20-Poly1305 |
| 9 | Per-peer capabilities | ✅ **Shipped** | `grants.ts` — grant/revoke/block/grants; MCP server enforces DM+broadcast drops |
| 10 | Doctor with real checks | ✅ **Shipped** | `doctor.ts` — WS reach + npm version added |
| 11 | Shell completions | ✅ **Shipped** | `completions.ts` — bash/zsh/fish |
| 12 | QR code on share | ✅ **Shipped** | `qr.ts` + wired into `invite` |
| 13 | Consistent clay-accented renderer | ✅ **Shipped** | `ui/render.ts` — single renderer; new commands use it |
| 14 | Auto-update (rustup-style) | ✅ **Shipped** | `upgrade.ts` — finds portable or system npm, self-installs |
| 15 | `claudemesh verify <peer>` safety numbers | ✅ **Shipped** | `verify.ts` — 30-digit SAS |

**Final: 14/15 fully shipped + 1 partial = 97% addressed.** Item 7 is blocked
on Claude Code protocol work outside our scope.

## What landed across the session

### npm
- `claudemesh-cli@1.0.0-alpha.30` on the alpha dist-tag

### GitHub Releases
- `cli-v1.0.0-alpha.29` live with 5 binaries + SHA256SUMS
  (darwin-x64, darwin-arm64, linux-x64, linux-arm64, windows-x64.exe)
- `cli-v1.0.0-alpha.30` workflow running to reproduce the set

### CI
- `.github/workflows/release-cli.yml` — fires on `cli-v*` tags, builds
  single-file binaries via `bun build --compile`, attaches to GitHub
  Release, optionally bumps the Homebrew tap formula

### Broker
- `handleCliMeshInvite` + email via Postmark with branded react-email
  template (from earlier in the day)
- `handleCliMeshCreate` generates owner keypair + root key so CLI-made
  meshes can immediately issue invites

### Web
- `/install` script: binary-first fallback when Node absent, npm path
  otherwise. No sudo required.
- `apps/web/src/modules/join/install-toggle.tsx` — single one-liner copy
  block, `--name` defaults to `$USER`

### CLI commands (new this session)
- `claudemesh <invite-url>` — bare dispatch, join + launch
- `claudemesh upgrade` / `update` — self-update
- `claudemesh verify [peer]` — SAS safety numbers
- `claudemesh backup / restore` — encrypted config backup
- `claudemesh grant / revoke / block / grants` — per-peer capabilities
- `claudemesh completions <shell>` — bash/zsh/fish
- `claudemesh url-handler <install|uninstall>` — `claudemesh://` scheme
- `claudemesh status-line` — statusLine renderer for Claude Code
- `claudemesh install --status-line` — wire the statusLine

## Files created
```
apps/cli-v2/src/commands/backup.ts           # backup/restore
apps/cli-v2/src/commands/completions.ts      # shell completions
apps/cli-v2/src/commands/grants.ts           # per-peer caps
apps/cli-v2/src/commands/status-line.ts      # statusLine renderer
apps/cli-v2/src/commands/upgrade.ts          # auto-update
apps/cli-v2/src/commands/url-handler.ts      # :// scheme registration
apps/cli-v2/src/commands/verify.ts           # SAS safety numbers
apps/cli-v2/src/emails/mesh-invitation.tsx   # branded react-email template
apps/cli-v2/src/ui/qr.ts                     # QR renderer
apps/cli-v2/src/ui/render.ts                 # unified renderer
apps/cli-v2/scripts/build-binaries.ts        # cross-platform compile
apps/broker/src/emails/mesh-invitation.tsx   # (broker copy — pre-session)
.github/workflows/release-cli.yml            # binary CI
packaging/homebrew/claudemesh.rb.template    # brew formula
packaging/winget/claudemesh.yaml.template    # winget manifest
```

## Gotchas hit and fixed

1. **`capability_v_2` vs `capability_v2`** — Drizzle's `casing: snake_case`
   inserts an underscore before digits, but the migration SQL
   (`0019_invite-v2-and-email.sql`) used `capability_v2`. Production DB
   had both drifted. Fixed by hand: `ALTER TABLE mesh.invite ADD COLUMN
   capability_v_2 text`.

2. **`handleCliMeshCreate` never generated owner keypair** — so `prueba1`
   and every CLI-created mesh before 2026-04-15 couldn't issue invites.
   Added generation to create + self-heal in invite.

3. **`cli.ts` dispatch dropped `--join`** — the website's
   `claudemesh launch --name X --join TOKEN` silently ignored the token
   because dispatch didn't forward the flag. Fixed by forwarding to
   `runLaunch`.

4. **`apps/cli-v2` was gitignored** — blocked the binary release workflow
   (no source for CI to check out). Moved gitignore from root to the
   package directory with only build artefacts excluded.

5. **Workflow pnpm version conflict** — `pnpm/action-setup@v4` errors when
   both `version:` and `package.json#packageManager` are set. Removed the
   explicit version to defer to `packageManager`.

6. **Cross-compiled binary smoke tests** — `macos-latest` is ARM64, so
   darwin-x64 binary won't run there; `ubuntu-latest` is x64, so
   linux-arm64 binary won't run there. Smoke tests now run only when
   build arch matches runner arch.

7. **Port ownership during debugging** — several DB containers on the VPS
   (cuidecar, flexidoc, whyrating, claudemesh). Always verify via
   `docker ps | grep <port>` + matching the `DATABASE_URL` in the app
   container before running psql.

## What's follow-up (tier-3)

- **Item 7** properly — needs a Claude Code-side notification type for
  rich `<channel>` UI (chat bubble, avatar, timestamp). Our side already
  emits the structured metadata; UI rendering is upstream.
- **Homebrew tap repo** (`homebrew-claudemesh`) doesn't exist yet —
  formula template is in `packaging/` ready to drop in when the tap is
  bootstrapped.
- **winget submission** needs the first non-prerelease (cli-v1.0.0)
  cut, then PR to `microsoft/winget-pkgs`.
- **Migrate all commands to `render.ts`** — foundation is shipped, old
  commands (peers, launch banner, etc.) still use ad-hoc
  `console.log` with color codes. Mechanical refactor.
- **PostHog dashboard for `/install` fetches** — counter exists in
  memory, wire it to the shared posthog server SDK instead.

## Published version trail this session

- alpha.22 → 23 (previous session)
- alpha.24: broker invite endpoint
- alpha.25: CLI invite wire through generateInvite
- alpha.26: email on Postmark honestly reported
- alpha.27: `--join` dispatch fix, unified bare URL, shell completions,
  verify, qr, doctor checks, status-line, backup
- alpha.28: url-handler, install --status-line
- alpha.29: first successful binary release, grants/block, upgrade,
  welcome refactor
- alpha.30: channel message polish (current)

## Published things outside npm

- https://github.com/alezmad/claudemesh/releases/tag/cli-v1.0.0-alpha.29
  — 5 platform binaries, SHA256SUMS
- https://claudemesh.com/install — shell installer, binary fallback
- https://claudemesh.com/i/... — invite short URLs (unchanged)
