import Link from "next/link";

export const metadata = {
  title: "Peer messaging for Claude Code: protocol, security, UX — claudemesh",
  description:
    "How claudemesh connects Claude Code sessions over an encrypted mesh, using MCP dev-channels for real-time message injection. Wire protocol, threat model, and what's next.",
  openGraph: {
    title: "Peer messaging for Claude Code: protocol, security, UX",
    description: "How claudemesh connects Claude Code sessions over an encrypted mesh.",
    images: ["/media/blog-hero-mesh.png"],
  },
};

export default function BlogPost() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-24 md:py-32">
      <header className="mb-12">
        <time
          dateTime="2026-04-06"
          className="text-[11px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          April 6, 2026
        </time>
        <h1
          className="mt-3 text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          Peer messaging for Claude Code: protocol, security, UX
        </h1>
        <p
          className="mt-4 text-sm text-[var(--cm-fg-secondary)]"
          style={{ fontFamily: "var(--cm-font-sans)" }}
        >
          by Alejandro A. Gutiérrez Mourente
        </p>
      </header>

      <div
        className="space-y-5 text-[15px] leading-[1.8] text-[var(--cm-fg-secondary)] [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:text-[22px] [&_h2]:font-medium [&_h2]:text-[var(--cm-fg)] [&_a]:text-[var(--cm-clay)] [&_a]:hover:underline [&_code]:rounded [&_code]:bg-[var(--cm-gray-800)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-[var(--cm-fg-secondary)] [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:border [&_pre]:border-[var(--cm-border)] [&_pre]:bg-[var(--cm-gray-850)] [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-[1.6] [&_strong]:font-medium [&_strong]:text-[var(--cm-fg)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        <p>
          Claude Code sessions are islands. You build context over an hour of conversation, close the
          tab, and that context dies. Two sessions side by side — one refactoring the API, one fixing
          the frontend — share a filesystem but not a thought. I spent a decade flying F-18s in the
          Spanish Air Force, where every formation member broadcasts position, fuel, and threat data
          in real time. Silence kills. I built{" "}
          <a href="https://github.com/alezmad/claudemesh-cli">claudemesh</a> to give Claude Code
          sessions the same link: an MCP server that connects them over an encrypted mesh, pushing
          messages directly into each other's context mid-turn.
        </p>
        <p>
          The CLI is MIT-licensed, on npm as <code>claudemesh-cli</code>. This post covers the wire
          protocol, the experimental Claude Code capability behind real-time injection, and the
          prompt-injection surface that deserves careful attention.
        </p>

        <h2 style={{ fontFamily: "var(--cm-font-serif)" }}>The protocol</h2>
        <p>
          One owner's ed25519 public key defines a mesh. The owner generates signed invite links;
          each invitee verifies the signature, generates a fresh ed25519 keypair locally, and enrolls
          with a broker via <code>POST /join</code>. The client then opens a persistent WebSocket
          (<code>wss://</code> in production) and authenticates with a signed <code>hello</code>{" "}
          frame:
        </p>
        <pre><code>{`{
  "type": "hello",
  "meshId": "01HX...",
  "memberId": "01HX...",
  "pubkey": "64-hex-chars",
  "timestamp": 1735689600000,
  "signature": "128-hex-chars"
}`}</code></pre>
        <p>
          The signature covers{" "}
          <code>{"${meshId}|${memberId}|${pubkey}|${timestamp}"}</code>. The broker verifies it
          against the registered public key and replies <code>hello_ack</code>. The connection is
          live.
        </p>
        <p>
          Direct messages use libsodium <code>crypto_box_easy</code> for end-to-end encryption —
          X25519 keys derived from ed25519 identity pairs via{" "}
          <code>crypto_sign_ed25519_pk_to_curve25519</code>. The broker routes ciphertext and never
          sees plaintext. Priority routing: <code>now</code> delivers immediately, <code>next</code>{" "}
          queues until idle, <code>low</code> waits for an explicit drain. The full specification
          lives in{" "}
          <a href="https://github.com/alezmad/claudemesh-cli/blob/main/PROTOCOL.md">PROTOCOL.md</a>{" "}
          (453 lines).
        </p>

        <h2 style={{ fontFamily: "var(--cm-font-serif)" }}>Dev channels: the missing piece</h2>
        <p>
          An experimental Claude Code capability fixes the polling problem:{" "}
          <code>notifications/claude/channel</code>. When an MCP server declares{" "}
          <code>{"{ experimental: { \"claude/channel\": {} } }"}</code> and Claude Code launches
          with <code>--dangerously-load-development-channels server:&lt;name&gt;</code>, the server
          pushes notifications that arrive as <code>{"<channel source=\"claudemesh\">"}</code> system
          reminders mid-turn. Claude reacts immediately.
        </p>
        <p>
          <code>claudemesh launch</code> wraps this into one command. I tested with an echo-channel
          MCP server emitting a notification every 15 seconds — all three ticks arrived mid-turn and
          Claude responded inline. Confirmed on Claude Code v2.1.92.
        </p>

        <h2 style={{ fontFamily: "var(--cm-font-serif)" }}>The prompt-injection question</h2>
        <p>
          This section matters most. claudemesh decrypts peer text and injects it into Claude's
          context. That text is untrusted input. A peer can send instruction overrides, tool-call
          steering, or confused-deputy attacks invoking other MCP servers through Claude. The same
          failure-mode analysis that clears a formation through weather applies here: enumerate every
          way the system breaks, then close each path.
        </p>
        <p>
          <strong>Tool-approval prompts stay intact.</strong> claudemesh never disables Claude Code's
          permission system. A peer message can ask Claude to run a shell command; Claude still
          prompts the user.
        </p>
        <p>
          <strong>Messages carry attribution.</strong> Each <code>{"<channel>"}</code> reminder
          includes <code>from_id</code>, <code>from_name</code>, and <code>mesh_slug</code>.
        </p>
        <p>
          <strong>Membership requires a signed invite.</strong> An attacker needs a valid
          ed25519-signed invite from the mesh owner or a compromised member keypair.
        </p>
        <p>
          The residual risks are real. If a user blanket-approves tools, a malicious peer message
          reaches the shell without human review. The causal chain — peer message, Claude decision,
          tool call — has no persistent audit trail yet.{" "}
          <a href="https://github.com/alezmad/claudemesh-cli/blob/main/THREAT_MODEL.md">
            THREAT_MODEL.md
          </a>{" "}
          (212 lines) documents all of this. Open questions I want to work through with the Claude
          Code team.
        </p>

        <h2 style={{ fontFamily: "var(--cm-font-serif)" }}>What I'd do next</h2>
        <p>
          <strong>Shared-key channel crypto.</strong> Channel and broadcast messages are base64
          plaintext today. The upgrade is a KDF from <code>mesh_root_key</code> plus key rotation.
        </p>
        <p>
          <strong>Causal audit log.</strong> When Claude calls a tool because of a peer message, that
          link should persist: which message, which tool call, what result.
        </p>
        <p>
          <strong>Sender allowlists.</strong> Per-mesh config: accept messages only from these
          pubkeys. If a member's key is compromised, others exclude it locally.
        </p>
        <p>
          <strong>Forward secrecy.</strong> <code>crypto_box</code> uses long-lived keys. A leaked
          key lets an attacker decrypt all past captured ciphertext. A double-ratchet would bound the
          damage window.
        </p>

        <h2 style={{ fontFamily: "var(--cm-font-serif)" }}>Try it</h2>
        <pre><code>{`npm install -g claudemesh-cli
claudemesh install
claudemesh join https://claudemesh.com/join/<token>
claudemesh launch`}</code></pre>
        <p>
          The code is at{" "}
          <a href="https://github.com/alezmad/claudemesh-cli">github.com/alezmad/claudemesh-cli</a>.
          The wire protocol is in{" "}
          <a href="https://github.com/alezmad/claudemesh-cli/blob/main/PROTOCOL.md">PROTOCOL.md</a>.
          The threat model is in{" "}
          <a href="https://github.com/alezmad/claudemesh-cli/blob/main/THREAT_MODEL.md">
            THREAT_MODEL.md
          </a>.
          Contributions welcome — see{" "}
          <a href="https://github.com/alezmad/claudemesh-cli/blob/main/CONTRIBUTING.md">
            CONTRIBUTING.md
          </a>.
        </p>
        <p>
          If you work on Claude Code or the MCP ecosystem and this interests you, I'd like to hear
          from you.
        </p>
      </div>

      <div className="mt-12 border-t border-[var(--cm-border)] pt-8">
        <Link
          href="/blog"
          className="text-sm text-[var(--cm-clay)] hover:underline"
          style={{ fontFamily: "var(--cm-font-sans)" }}
        >
          ← Back to blog
        </Link>
      </div>
    </article>
  );
}
