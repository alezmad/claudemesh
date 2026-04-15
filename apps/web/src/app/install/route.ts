/**
 * GET /install — shell installer for claudemesh-cli.
 *
 * curl -fsSL https://claudemesh.com/install | bash
 *
 * Tracks each fetch server-side (PostHog server event + console log).
 * curl doesn't execute JS, so client-side analytics can't track this.
 */

import { headers } from "next/headers";

// In-memory counter (resets on deploy — good enough for a signal).
// For persistent tracking, write to DB or use PostHog server SDK.
let installFetches = 0;

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
say "  1. Paste your invite link:  \${BOLD}claudemesh <invite-url>\${RESET}"
say "     (joins + launches Claude Code in one step)"
say ""
say "  2. Enable click-to-launch from email:"
say "     \${BOLD}claudemesh url-handler install\${RESET}"
say ""
say "  3. Shell completions (optional):"
say "     \${DIM}claudemesh completions zsh > ~/.zfunc/_claudemesh\${RESET}"
say ""
say "Need an invite? Visit \${BOLD}https://claudemesh.com\${RESET}"
say ""
`;

export async function GET(): Promise<Response> {
  installFetches++;

  // Log server-side for monitoring
  const h = await headers();
  const ua = h.get("user-agent") ?? "unknown";
  const ip = h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "unknown";
  const referer = h.get("referer") ?? "direct";

  console.log(
    `[install] #${installFetches} | ip=${ip} | ua=${ua.slice(0, 80)} | ref=${referer}`,
  );

  // PostHog server-side event (if configured)
  try {
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
    if (posthogKey && posthogHost) {
      fetch(`${posthogHost}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: posthogKey,
          event: "install_script_fetched",
          distinct_id: ip,
          properties: {
            user_agent: ua,
            referer,
            install_count: installFetches,
          },
        }),
      }).catch(() => {}); // fire-and-forget
    }
  } catch {}

  return new Response(SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
