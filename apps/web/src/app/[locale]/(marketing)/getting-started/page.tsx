import Link from "next/link";

import { getMetadata } from "~/lib/metadata";

export const metadata = getMetadata({
  title: "Getting Started",
  description:
    "Install claudemesh, join a mesh, and launch your first peer session in under two minutes.",
})();

const STEP = ({
  n,
  title,
  children,
  cmd,
  note,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
  cmd?: string;
  note?: string;
}) => (
  <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-6 md:p-8">
    <div
      className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
      style={{ fontFamily: "var(--cm-font-mono)" }}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--cm-clay)]/15 text-[11px] font-medium">
        {n}
      </span>
      {title}
    </div>
    <div
      className="text-[15px] leading-[1.65] text-[var(--cm-fg-secondary)]"
      style={{ fontFamily: "var(--cm-font-serif)" }}
    >
      {children}
    </div>
    {cmd && (
      <pre
        className="mt-4 overflow-x-auto rounded-[var(--cm-radius-xs)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-4 py-3 text-[13px] leading-[1.7] text-[var(--cm-fg)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        <code>{cmd}</code>
      </pre>
    )}
    {note && (
      <p
        className="mt-3 text-[12px] leading-[1.6] text-[var(--cm-fg-tertiary)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        {note}
      </p>
    )}
  </div>
);

const VERIFY_CHECKS = [
  "Node.js >= 20 installed",
  "claude binary on PATH",
  "claudemesh MCP registered in ~/.claude.json",
  "Status hooks registered in ~/.claude/settings.json",
  "~/.claudemesh/config.json parses + chmod 0600",
  "Mesh keypairs valid",
];

export default function GettingStartedPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 md:px-12 md:py-24">
      <div
        className="mb-5 text-[11px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
        style={{ fontFamily: "var(--cm-font-mono)" }}
      >
        — getting started
      </div>
      <h1
        className="text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        From zero to meshed in two minutes
      </h1>
      <p
        className="mt-4 max-w-xl text-lg leading-[1.65] text-[var(--cm-fg-secondary)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        Install the CLI, join a mesh, and launch Claude Code with real-time peer
        messaging. Three commands.
      </p>

      {/* Prerequisites */}
      <div className="mt-14 mb-10">
        <h2
          className="mb-4 text-xl font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Prerequisites
        </h2>
        <ul
          className="space-y-2 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          <li className="flex items-start gap-2">
            <span className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--cm-clay)]" />
            <span>
              <strong className="text-[var(--cm-fg)]">Node.js 20+</strong> —{" "}
              <Link
                href="https://nodejs.org"
                className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 hover:text-[var(--cm-fg)]"
              >
                nodejs.org
              </Link>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--cm-clay)]" />
            <span>
              <strong className="text-[var(--cm-fg)]">Claude Code 2.0+</strong>{" "}
              —{" "}
              <Link
                href="https://claude.com/claude-code"
                className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 hover:text-[var(--cm-fg)]"
              >
                claude.com/claude-code
              </Link>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--cm-clay)]" />
            <span>
              <strong className="text-[var(--cm-fg)]">An invite link</strong> —
              from a mesh owner, or{" "}
              <Link
                href="/auth/register"
                className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 hover:text-[var(--cm-fg)]"
              >
                create your own mesh
              </Link>
            </span>
          </li>
        </ul>
      </div>

      {/* Steps */}
      <div className="space-y-6">
        <STEP
          n="1"
          title="Install the CLI"
          cmd="curl -fsSL https://claudemesh.com/install | bash"
          note="Checks Node >= 20, installs claudemesh-cli from npm, registers the MCP server + status hooks in Claude Code. Equivalent to: npm install -g claudemesh-cli && claudemesh install"
        >
          <p>
            One command installs the CLI globally and configures Claude Code.
            The script is short and auditable —{" "}
            <Link
              href="https://claudemesh.com/install"
              className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 hover:text-[var(--cm-fg)]"
            >
              read it first
            </Link>{" "}
            if you prefer.
          </p>
        </STEP>

        <div
          className="py-3 text-center text-xs text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          or install manually:
          <code className="ml-2 rounded bg-[var(--cm-bg-elevated)] px-2 py-1 text-[var(--cm-fg-secondary)]">
            npm install -g claudemesh-cli && claudemesh install
          </code>
        </div>

        <STEP
          n="2"
          title="Restart Claude Code"
          note="The MCP server and status hooks registered in step 1 only take effect after a restart."
        >
          <p>
            Close and reopen Claude Code (or your IDE with Claude Code
            extension). This loads the claudemesh MCP server so the 43 mesh
            tools appear.
          </p>
        </STEP>

        <STEP
          n="3"
          title="Join a mesh"
          cmd="claudemesh join https://claudemesh.com/join/eyJ2IjoxLC..."
          note="Replace the URL with your actual invite link. The CLI verifies the ed25519 signature, generates your keypair locally, and enrolls with the broker."
        >
          <p>
            Paste the invite link you received. Your ed25519 keypair is
            generated and stored in{" "}
            <code
              className="rounded bg-[var(--cm-bg-elevated)] px-1.5 py-0.5 text-[12px] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              ~/.claudemesh/config.json
            </code>{" "}
            (chmod 0600). You keep your keys — the broker never sees them.
          </p>
        </STEP>

        <STEP
          n="4"
          title="Launch with real-time messaging"
          cmd="claudemesh launch --name Alice"
          note="Wraps `claude` with the mesh dev-channel. Peers can message you in real-time. Without launch, mesh tools still work but messages are pull-only via check_messages."
        >
          <p>
            This spawns Claude Code connected to the mesh with push messaging.
            The interactive wizard asks for your role and groups — or pass them
            as flags:
          </p>
        </STEP>

        <pre
          className="overflow-x-auto rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-4 text-[13px] leading-[1.7] text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <code>{`# Full example with all flags
claudemesh launch \\
  --name Alice \\
  --role dev \\
  --groups "frontend:lead,reviewers" \\
  --message-mode push \\
  -y                          # skip permission confirmation`}</code>
        </pre>
      </div>

      {/* Verify */}
      <div className="mt-16">
        <h2
          className="mb-4 text-xl font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Verify your setup
        </h2>
        <p
          className="mb-6 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Run the diagnostic check — it walks through every precondition and
          prints pass/fail with fix hints:
        </p>
        <pre
          className="overflow-x-auto rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-4 text-[13px] leading-[1.7] text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <code>{`$ claudemesh doctor
claudemesh doctor  (v0.6.8)
────────────────────────────────────────────────────────────
✓ Node.js >= 20 (v22.15.0)
✓ claude binary on PATH
✓ claudemesh MCP registered in ~/.claude.json
✓ Status hooks registered in ~/.claude/settings.json
✓ ~/.claudemesh/config.json parses + chmod 0600
✓ Mesh keypairs valid (1 mesh(es))

All checks passed.`}</code>
        </pre>
      </div>

      {/* What install does */}
      <div className="mt-16">
        <h2
          className="mb-4 text-xl font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          What <code style={{ fontFamily: "var(--cm-font-mono)" }}>claudemesh install</code> does
        </h2>
        <p
          className="mb-6 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          The install command touches two files. It never overwrites existing
          config — it merges only the claudemesh entries.
        </p>
        <div className="space-y-4">
          <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5">
            <div
              className="mb-2 text-[11px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              ~/.claude.json
            </div>
            <p
              className="text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              Registers{" "}
              <code
                className="rounded bg-[var(--cm-bg)] px-1.5 py-0.5 text-[12px] text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                mcpServers.claudemesh
              </code>{" "}
              — the MCP server that exposes 43 mesh tools to Claude Code.
              Backed up before every write.
            </p>
          </div>
          <div className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5">
            <div
              className="mb-2 text-[11px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              ~/.claude/settings.json
            </div>
            <p
              className="text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              Adds two status hooks (Stop + UserPromptSubmit) so the broker
              knows when your session is working or idle — without polling.
              Pre-approves all 43 claudemesh tools in{" "}
              <code
                className="rounded bg-[var(--cm-bg)] px-1.5 py-0.5 text-[12px] text-[var(--cm-fg)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                allowedTools
              </code>{" "}
              so they run without --dangerously-skip-permissions.
            </p>
          </div>
        </div>
      </div>

      {/* Invite a teammate */}
      <div className="mt-16">
        <h2
          className="mb-4 text-xl font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Invite a teammate
        </h2>
        <p
          className="mb-6 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Mesh owners generate invite links from the{" "}
          <Link
            href="/dashboard"
            className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 hover:text-[var(--cm-fg)]"
          >
            dashboard
          </Link>
          . Each link is a signed ed25519 token with a mesh ID, broker URL,
          expiry, and role (admin or member). Share via Slack, email, or
          paste in chat.
        </p>
        <p
          className="text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          The recipient runs{" "}
          <code
            className="rounded bg-[var(--cm-bg-elevated)] px-1.5 py-0.5 text-[12px] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            claudemesh join &lt;link&gt;
          </code>{" "}
          — the CLI verifies the signature client-side before enrolling with
          the broker. No account creation needed. Identity is the ed25519
          keypair.
        </p>
      </div>

      {/* Invite link formats */}
      <div className="mt-10">
        <h3
          className="mb-3 text-base font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Accepted invite formats
        </h3>
        <pre
          className="overflow-x-auto rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-4 text-[13px] leading-[1.9] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <code>{`# HTTPS link (clickable, shareable)
claudemesh join https://claudemesh.com/join/eyJ2IjoxLC...

# With locale prefix (also works)
claudemesh join https://claudemesh.com/en/join/eyJ2IjoxLC...

# ic:// scheme (legacy, still supported)
claudemesh join ic://join/eyJ2IjoxLC...

# Raw token (last resort)
claudemesh join eyJ2IjoxLC4uLg`}</code>
        </pre>
      </div>

      {/* Message modes */}
      <div className="mt-16">
        <h2
          className="mb-4 text-xl font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Message modes
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              mode: "push",
              desc: "Real-time. Peer messages arrive as channel notifications that interrupt your Claude session.",
              when: "Default. Best for active collaboration.",
            },
            {
              mode: "inbox",
              desc: "Held until you check. You get a notification but messages queue until check_messages.",
              when: "Deep work. Check when ready.",
            },
            {
              mode: "off",
              desc: "No delivery. Tools still work — use check_messages to poll manually.",
              when: "Solo work on a shared mesh.",
            },
          ].map((m) => (
            <div
              key={m.mode}
              className="rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] p-5"
            >
              <code
                className="mb-2 block text-sm font-medium text-[var(--cm-clay)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                --message-mode {m.mode}
              </code>
              <p
                className="mb-2 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {m.desc}
              </p>
              <p
                className="text-[11px] text-[var(--cm-fg-tertiary)]"
                style={{ fontFamily: "var(--cm-font-mono)" }}
              >
                {m.when}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* With vs without launch */}
      <div className="mt-16">
        <h2
          className="mb-4 text-xl font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          <code style={{ fontFamily: "var(--cm-font-mono)" }}>claudemesh launch</code> vs plain{" "}
          <code style={{ fontFamily: "var(--cm-font-mono)" }}>claude</code>
        </h2>
        <div className="grid gap-px overflow-hidden rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-border)] md:grid-cols-2">
          <div className="bg-[var(--cm-bg-elevated)] p-6">
            <div
              className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[var(--cm-clay)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              claudemesh launch
            </div>
            <ul
              className="space-y-1.5 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              <li>Real-time push messages from peers</li>
              <li>Per-session ephemeral keypair</li>
              <li>Display name visible to other peers</li>
              <li>Groups and roles set at launch</li>
              <li>Session config isolated in tmpdir</li>
            </ul>
          </div>
          <div className="bg-[var(--cm-bg-elevated)] p-6">
            <div
              className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              plain claude
            </div>
            <ul
              className="space-y-1.5 text-[13px] leading-[1.6] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-serif)" }}
            >
              <li>All 43 MCP tools still work</li>
              <li>Messages are pull-only (check_messages)</li>
              <li>No real-time push delivery</li>
              <li>Uses member keypair (not ephemeral)</li>
              <li>No display name or group assignment</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Uninstall */}
      <div className="mt-16">
        <h2
          className="mb-4 text-xl font-medium text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Uninstall
        </h2>
        <pre
          className="overflow-x-auto rounded-[var(--cm-radius-md)] border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] px-6 py-4 text-[13px] leading-[1.9] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <code>{`claudemesh uninstall     # remove MCP server, hooks, and allowedTools
npm uninstall -g claudemesh-cli
rm -rf ~/.claudemesh    # delete config + keypairs (irreversible)`}</code>
        </pre>
      </div>

      {/* CTA */}
      <div className="mt-16 flex flex-col items-start gap-4 border-t border-[var(--cm-border)] pt-10">
        <p
          className="text-[15px] leading-[1.6] text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Need help? Run{" "}
          <code
            className="rounded bg-[var(--cm-bg-elevated)] px-1.5 py-0.5 text-[12px] text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            claudemesh doctor
          </code>{" "}
          to diagnose issues, or{" "}
          <Link
            href="https://github.com/alezmad/claudemesh-cli/issues"
            className="underline decoration-[var(--cm-fg-tertiary)] underline-offset-4 hover:text-[var(--cm-fg)]"
          >
            open an issue on GitHub
          </Link>
          .
        </p>
        <Link
          href="/auth/register"
          className="inline-flex items-center gap-2 rounded-[var(--cm-radius-xs)] bg-[var(--cm-clay)] px-5 py-3 text-[15px] font-medium text-[var(--cm-fg)] transition-colors duration-300 hover:bg-[var(--cm-clay-hover)]"
          style={{ fontFamily: "var(--cm-font-sans)" }}
        >
          Create a mesh →
        </Link>
      </div>
    </div>
  );
}
