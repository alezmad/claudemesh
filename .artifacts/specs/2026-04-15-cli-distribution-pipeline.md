# CLI Distribution Pipeline

## Status
- Shell installer (`/install`): ✅ live, needs polish
- Single-binary build script (`scripts/build-binaries.ts`): ✅ written, not wired to CI
- GitHub Releases publish: ❌ not set up
- Homebrew tap: ❌ not set up
- winget manifest: ❌ not set up

## Shipped this session (alpha.28)
- `bun build --compile` script at `apps/cli-v2/scripts/build-binaries.ts` produces
  `dist/bin/claudemesh-{darwin,linux,windows}-{x64,arm64}` locally.
- `/install` updated to use the one-command `claudemesh <invite-url>` flow.
- `claudemesh url-handler install` registers the `claudemesh://` scheme on the three OSes.

## What's missing

### 1. GitHub Actions to build + publish binaries
```yaml
# .github/workflows/release-binaries.yml
on: { push: { tags: ['v*'] } }
jobs:
  build:
    strategy: { matrix: { target: [darwin-x64, darwin-arm64, linux-x64, linux-arm64, windows-x64] } }
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: cd apps/cli-v2 && bun install --frozen-lockfile
      - run: cd apps/cli-v2 && bun run scripts/build-binaries.ts
      - uses: softprops/action-gh-release@v2
        with: { files: apps/cli-v2/dist/bin/* }
```

### 2. `/install` detects missing Node and downloads a binary
Current `/install` requires Node 20+. Next iteration: detect absence, curl the
right binary from GitHub Releases, drop it in `~/.claudemesh/bin/`, add to PATH.

### 3. Homebrew tap (`homebrew-claudemesh`)
Separate repo with a formula that points at the GitHub Release artifact.
Users: `brew install alezmad/claudemesh/claudemesh`. Auto-updated by the
release workflow via `brew bump-formula-pr`.

### 4. winget manifest
YAML in `microsoft/winget-pkgs` repo pointing at the Windows .exe.

### 5. Auto-update in-CLI
Already have `showUpdateNotice`. Upgrade to offer `claudemesh upgrade` that
re-runs `/install` OR downloads a new binary in place.

## Why this matters
Current state: users need Node, npm, and patience. Goal state:
```
curl -fsSL claudemesh.com/install | sh
```
…and that's it, on any OS, with or without Node.

## Priority
After tier-1 usability (done), this is the next biggest lever for adoption.
Estimate: 1-2 days for full pipeline, mostly CI config + release testing.
