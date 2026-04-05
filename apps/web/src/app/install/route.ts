/**
 * GET /install — serves a shell installer for claudemesh-cli.
 *
 * Intended to be piped into bash:
 *   curl -fsSL https://claudemesh.com/install | bash
 *
 * The script is kept short + auditable. It does not try to install
 * Node for the user — it checks for a compatible Node + npm and
 * directs them to install Node themselves if missing. Running `bash`
 * against a domain you do not fully trust is always a risk; publishing
 * the script this way (rather than obfuscating it behind a binary
 * blob) lets security-conscious users inspect before executing.
 */

const SCRIPT = `#!/usr/bin/env bash
# claudemesh-cli installer
# Source: https://claudemesh.com/install
# Audit: curl -fsSL https://claudemesh.com/install | less
set -euo pipefail

RED=$'\\033[31m'; GREEN=$'\\033[32m'; DIM=$'\\033[2m'; BOLD=$'\\033[1m'; RESET=$'\\033[0m'

say() { printf "%s\\n" "$*"; }
ok()  { printf "%s✓%s %s\\n" "\${GREEN}" "\${RESET}" "$*"; }
err() { printf "%s✗%s %s\\n" "\${RED}" "\${RESET}" "$*" >&2; }

say ""
say "\${BOLD}claudemesh-cli installer\${RESET}"
say "$(printf '%.0s─' {1..40})"

# --- preflight ------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed."
  say "   Install Node.js 20 or newer: \${BOLD}https://nodejs.org\${RESET}"
  say "   Or via nvm: \${DIM}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash\${RESET}"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js $(node -v) is too old — claudemesh-cli needs >= 20."
  say "   Upgrade: \${BOLD}https://nodejs.org\${RESET}"
  exit 1
fi
ok "Node.js $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm is not installed (usually ships with Node)."
  exit 1
fi
ok "npm $(npm -v)"

# --- install --------------------------------------------------------

say ""
say "Installing \${BOLD}claudemesh-cli\${RESET} from npm…"
if ! npm install -g claudemesh-cli; then
  err "npm install failed."
  say "   If this is a permissions error on macOS/Linux, try:"
  say "   \${DIM}sudo npm install -g claudemesh-cli\${RESET}"
  say "   or configure npm to use a user-owned prefix:"
  say "   \${DIM}https://docs.npmjs.com/resolving-eacces-permissions-errors\${RESET}"
  exit 1
fi
ok "claudemesh-cli installed ($(claudemesh --version))"

# --- register MCP + hooks ------------------------------------------

say ""
say "Registering Claude Code MCP server + status hooks…"
if ! claudemesh install; then
  err "claudemesh install failed — run it manually to see the error."
  exit 1
fi

# --- done -----------------------------------------------------------

say ""
say "\${GREEN}\${BOLD}Done.\${RESET}"
say ""
say "Next steps:"
say "  1. Restart Claude Code so the MCP tools appear."
say "  2. Join a mesh:      \${BOLD}claudemesh join <invite-url>\${RESET}"
say "  3. Launch with push: \${BOLD}claudemesh launch\${RESET}"
say ""
say "Need an invite? Visit \${BOLD}https://claudemesh.com\${RESET}"
say ""
`;

export function GET(): Response {
  return new Response(SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
