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
# Prefer npm when Node 20+ is present. Otherwise fall back to a
# self-contained binary download from GitHub Releases (installs to
# ~/.claudemesh/bin and adds a shim at ~/.local/bin/claudemesh).

detect_os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux)  echo linux  ;;
    *)      echo ""     ;;
  esac
}
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo x64   ;;
    arm64|aarch64) echo arm64 ;;
    *)             echo ""    ;;
  esac
}

install_via_binary() {
  local os arch url target dir shim
  os=$(detect_os); arch=$(detect_arch)
  if [ -z "$os" ] || [ -z "$arch" ]; then
    err "No precompiled binary for $(uname -s)/$(uname -m). Install Node 20+ or build from source."
    exit 1
  fi
  dir="\${HOME}/.claudemesh/bin"
  mkdir -p "$dir"
  target="\${dir}/claudemesh"
  url="https://github.com/alezmad/claudemesh/releases/latest/download/claudemesh-\${os}-\${arch}"
  say "Downloading \${BOLD}\${url}\${RESET}…"
  if ! curl -fsSL "$url" -o "$target"; then
    err "Download failed. Falling back to npm."
    return 1
  fi
  chmod +x "$target"
  shim="\${HOME}/.local/bin/claudemesh"
  mkdir -p "\${HOME}/.local/bin"
  printf '#!/bin/sh\\nexec "%s" "$@"\\n' "$target" > "$shim"
  chmod +x "$shim"
  ok "claudemesh binary installed → \${target}"
  case ":$PATH:" in
    *":\${HOME}/.local/bin:"*) : ;;
    *)
      say ""
      say "\${BOLD}Add \${HOME}/.local/bin to PATH\${RESET} (add to your shell rc):"
      say "  export PATH=\\"\${HOME}/.local/bin:\$PATH\\""
      ;;
  esac
  return 0
}

install_via_npm() {
  ok "Node.js $(node -v)"
  ok "npm $(npm -v)"
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
}

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
  if [ "$NODE_MAJOR" -ge 20 ] && command -v npm >/dev/null 2>&1; then
    install_via_npm
  else
    say "Node.js < 20 or no npm — using standalone binary."
    install_via_binary || install_via_npm
  fi
else
  say "Node.js not detected — installing standalone binary (no Node required)."
  install_via_binary
fi

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
