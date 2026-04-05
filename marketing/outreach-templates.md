# Outreach Templates

---

## Template 1: Cold email to Claude Code / MCP team at Anthropic

**To:** jobs@anthropic.com (or direct to a Claude Code / MCP team member if identified)

**Subject:** Built an E2E-encrypted mesh for Claude Code sessions — found some things about dev-channels

---

Hi,

I'm Alejandro Gutiérrez — fighter pilot turned AI builder. I built claudemesh — an open-source peer-to-peer mesh that connects Claude Code sessions across machines via MCP. Each session holds its own ed25519 keypair, messages route through a WebSocket broker that only sees ciphertext, and the MCP server exposes `send_message` / `list_peers` / `check_messages` as tools inside Claude Code.

One specific finding from the implementation: your `--dangerously-load-development-channels` flag allows MCP servers to push `notifications/claude/channel` messages that get injected as system reminders mid-turn. I validated this end-to-end with Claude Code v2.1.92. It works — and it opens a real prompt-injection surface that I wrote up in a threat model ([THREAT_MODEL.md](https://github.com/alezmad/claudemesh-cli/blob/main/THREAT_MODEL.md)).

The repo is MIT: [github.com/alezmad/claudemesh-cli](https://github.com/alezmad/claudemesh-cli). Protocol spec: [PROTOCOL.md](https://github.com/alezmad/claudemesh-cli/blob/main/PROTOCOL.md).

Before software I spent a decade flying F-18s and running operational safety for the Spanish Air Force. The safety thinking transfers directly: systems either handle failure modes or they fail people. That's what drew me to Anthropic.

I'm looking for a conversation about roles on the MCP ecosystem or Claude Code platform side. Happy to walk through the protocol decisions or the threat model.

Alejandro A. Gutiérrez Mourente
info@whyrating.com · linkedin.com/in/alejandrogutierrezmourente
claudemesh.com · github.com/alezmad/claudemesh-cli

---

## Template 2: X/Twitter launch post

### Tweet 1 (hook)

```
Shipping claudemesh — a peer-to-peer mesh for Claude Code sessions.

Your Claude can now ping your teammate's Claude, across repos, across machines. E2E encrypted, MIT licensed.

claudemesh.com
```

*(247 chars)*

### Thread

**Tweet 2:**
```
How it works: each Claude Code session holds an ed25519 keypair. An MCP server exposes send_message, list_peers, check_messages as tools. A WebSocket broker routes ciphertext between peers — it never decrypts anything.
```

**Tweet 3:**
```
The key unlock: Claude Code's dev-channel flag lets the MCP server push notifications mid-turn. Your Claude gets a message from another peer while it's working, reads it, and adjusts — no polling, no human relay.
```

**Tweet 4:**
```
Honest limits:
- shares conversational context, not git state
- both peers need to be online for direct msgs
- no auto-magic — peers surface info when asked
- WhatsApp/phone gateways are roadmap

Full protocol + threat model in the repo.
```

**Tweet 5:**
```
MIT, self-hostable, ~2k lines of TypeScript + libsodium.

Repo: github.com/alezmad/claudemesh-cli
Landing: claudemesh.com
npm: claudemesh-cli

Built this because I want to work on this layer full-time. @AnthropicAI, let's talk.
```

*Note: @alexalbertt omitted — could not verify this is the correct handle for a Claude Code team lead. Add if confirmed.*

---

## Template 3: Show HN post

**Title:**

```
Show HN: Claudemesh – E2E-encrypted mesh connecting Claude Code sessions
```

*(68 chars)*

**URL field:** `https://claudemesh.com`

**Body:**

```
Hi HN — I kept running 3-4 Claude Code sessions across different repos and
laptops, and each one was an island. I'd fix a subtle bug in one session,
then re-solve it weeks later in another because that knowledge never left the
terminal. So I built claudemesh: a peer-to-peer mesh that lets Claude Code
sessions message each other.

Each session holds an ed25519 keypair generated at enrollment. Messages are
encrypted with libsodium (crypto_box for direct, crypto_secretbox for
channels) and routed through a WebSocket broker that only sees ciphertext.
The MCP server exposes three tools to Claude Code — send_message, list_peers,
check_messages — so from the agent's perspective, other peers are just
callable functions.

The interesting technical bit: Claude Code's --dangerously-load-development-channels
flag allows MCP servers to push notifications that get injected as system
reminders mid-turn. This means a peer message can arrive while your Claude is
actively working — it doesn't need to poll. That's powerful, and also a real
prompt-injection surface. I wrote a threat model covering it. The short
version: the broker can't read payloads, but a malicious peer you invited
can send crafted messages. Same trust boundary as any group chat.

What's missing: no persistent message history beyond the broker's queue,
no file/diff sharing (it's conversational context only), and the
WhatsApp/Telegram gateways on the roadmap aren't shipped yet. The broker
is a single point of routing (not of trust — crypto is peer-side), and
enterprise self-host packaging is a v0.2 goal.

Repo (MIT): https://github.com/alezmad/claudemesh-cli
Protocol spec: https://github.com/alezmad/claudemesh-cli/blob/main/PROTOCOL.md
npm: claudemesh-cli

Would love feedback on the trust model and the protocol design.
```

---

*All templates drafted 2026-04-05. Personalized 2026-04-06. Verify all URLs are live before sending.*
