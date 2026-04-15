# Bootstrapping the `homebrew-claudemesh` tap

A Homebrew tap is just a GitHub repo named `homebrew-<anything>` in the
organization whose formulas you want to expose. Users add it with:

```
brew tap alezmad/claudemesh
brew install claudemesh
```

## One-time setup

1. Create a public GitHub repo called **`homebrew-claudemesh`** under the
   `alezmad` account (or any organization Homebrew can resolve — the name
   after `homebrew-` is the "tap" users type, and the owner is the namespace).
2. Copy `packaging/homebrew-tap-bootstrap/Formula/claudemesh.rb` from THIS
   repo into the tap's `Formula/claudemesh.rb`.
3. Fill in the `sha256` placeholders. For each platform, run:
   ```
   curl -sL https://github.com/alezmad/claudemesh/releases/download/cli-v1.0.0/claudemesh-darwin-arm64 | sha256sum
   ```
   (And so on for the three other platforms.)
4. Commit + push. Users can now `brew tap alezmad/claudemesh && brew install claudemesh`.

## Keeping it up to date

The release workflow (`.github/workflows/release-cli.yml`) has an
`update-homebrew` job that fires on non-prerelease tags. It calls
`brew bump-formula-pr` against the tap, which opens a PR with updated
`url`, `version`, and `sha256` entries.

Requires a `HOMEBREW_TAP_TOKEN` secret on the repo — a PAT scoped to the
tap repo with `contents:write`.

## Why not auto-create the repo from this workflow?

Repo creation needs org-level permissions that shouldn't live in CI. One
manual step, then everything after is automatic.
