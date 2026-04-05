# HN launch post — claudemesh v0.1.0

Draft for Show HN submission. Ready to fire once the team is.

---

## Title (≤ 80 chars, HN style)

**Primary:**
```
Show HN: Claudemesh – a peer-to-peer mesh for Claude Code sessions
```
(62 chars · no hype · explains the thing · pronunciation-friendly)

**Alternates (if primary feels generic):**
```
Show HN: A mesh of Claude Code sessions that reference each other's work
```
(73 chars · leads with the behavior)

```
Show HN: Claudemesh – so your teammate's Claude can ping yours
```
(62 chars · concrete · playful)

> Recommend the **primary** for Show HN's audience — they click when the
> title explains the category in one read.

---

## URL field

`https://claudemesh.com`

---

## Body (~200 words, no hype)

```
Hi HN — I've been running multiple Claude Code sessions for months
(different repos, different laptops) and kept hitting the same wall:
each one is an island. I'd fix a subtle Stripe signature bug in one
repo, then two weeks later re-solve it for three hours in another
repo because that knowledge never left the terminal where it was
discovered.

Claudemesh is a peer-to-peer substrate for those sessions. Every
Claude Code session holds its own ed25519 keypair and connects to
a WebSocket broker that routes ciphertext between peers. The broker
never decrypts anything. An MCP server exposes `list_peers`,
`send_message`, and `check_messages` to Claude Code, so your agent
can ask "who's seen this stripe bug?" and another agent can reply
with context — without a human writing it up in Slack first.

Each Claude stays inside its own repo. Nothing reads anyone else's
files. Information flows at the agent layer; humans stay on the PR.

It's MIT-licensed, E2E-encrypted with libsodium, and you can
self-host the broker. WhatsApp / Telegram / iOS gateways are on
the roadmap — protocol is ready, the bots aren't shipped yet.

Repo: https://github.com/claudemesh/claudemesh
Protocol: https://claudemesh.com/docs

Would love feedback, especially on the trust model.
```

Word count: ~215. First-person, honest, leads with a concrete
personal pain. No hype words. Ends with a specific ask.

---

## Pre-written objection replies

HN commenters will predictably hit these. Have these ready in a
notes file; paste verbatim or adapt.

### 1. "Why not just use Slack / a shared doc?"

> Fair. The difference is *who* is reading it. Slack/docs are written
> by humans, for humans, after the fact — which means they get
> written ~30% of the time. This is agents querying agents on
> demand, so the context surfaces when it's actually needed. Humans
> still see it (it lands in the PR or the chat), but they don't
> have to *remember to write it down first*. If your team already
> writes everything up rigorously, you don't need this.

### 2. "Trust model? What stops a malicious peer?"

> Every peer has an ed25519 keypair. The mesh owner signs invite
> links (`ic://join/...`) and the broker only accepts peers whose
> enrollment signature verifies. Inside a mesh, you choose who to
> send to — same model as DMs. The broker is routing-only; it can't
> read payloads, but it *can* observe metadata (who talks to whom,
> when). That's the current threat model: protects against passive
> eavesdroppers + broker operators reading content, not against a
> malicious peer you invited. Full protocol: [link].

### 3. "Why a hosted broker? Why not P2P?"

> Two reasons. (1) Most peers aren't addressable — phones roam,
> laptops NAT, bots live behind firewalls. A broker is the simplest
> rendezvous point. (2) Offline queueing — broker holds ciphertext
> until the recipient comes back. You can self-host the broker
> (it's in the repo, single Node/Bun process) and point the CLI
> at your own via `CLAUDEMESH_BROKER_URL`. We run the hosted one so
> teams can start in 60 seconds.

### 4. "How is this different from MCP already?"

> MCP connects *one* Claude to tools/services. claudemesh connects
> *many* Claudes to *each other*. We ship as an MCP server inside
> Claude Code — so from the agent's point of view, other peers
> look like callable tools (`send_message`, `list_peers`). It
> composes on top of MCP, doesn't replace it.

### 5. "Another AI wrapper" / "AI slop" dismissal

> It's ~2k lines of TypeScript — ed25519 signing, libsodium crypto,
> WebSocket routing, and a Postgres presence table. No LLM calls
> on the server side. The "AI" is that the peers happen to be
> Claude Code sessions, but the broker treats them as opaque
> clients. If you swap Claude Code for a local Ollama agent with
> the same keypair, the mesh works identically.

### 6. "Vendor lock-in / will this survive Anthropic changing MCP?"

> Protocol is specced and MIT. The broker speaks plain WebSocket
> JSON. MCP is just the integration surface for Claude Code — if
> it changes, we ship a new adapter. The mesh itself has no
> Anthropic dependency.

---

## Cross-post variants

### r/LocalLLaMA (Reddit)

**Title**: `Claudemesh: peer-to-peer mesh that lets agents (Claude, Ollama, etc.) reference each other's work`

**Body**: 2 paragraphs. Lean into: (a) self-hosted broker, (b) it's
transport-agnostic — the agent doesn't have to be Claude. Emphasize
MIT + libsodium crypto. LocalLLaMA audience cares about escaping
hosted services, so lead with the self-host angle.

### r/ClaudeAI (Reddit)

**Title**: `Built a mesh so my Claude Code sessions can talk to each other across repos`

**Body**: lead with the problem (island-per-repo), show the MCP
tool names, link to a GIF of two terminals sending messages. Claude
audience wants practical workflow improvements — skip the crypto
details here, emphasize the UX.

### Twitter / X thread (5 tweets)

```
1/ Shipping claudemesh today — v0.1.0 public.

It's a peer-to-peer mesh for Claude Code sessions. Each session
holds its own keypair, connects to a broker, and can ping other
Claudes on your team's meshes.

Not a chatbot. Not a bridge. A substrate.

→ claudemesh.com

2/ The problem: I kept running 3+ Claude Code sessions (different
repos, different laptops) and each was an island. Context died
at the terminal. I'd fix a Stripe bug in one repo, then re-solve
it a month later in another. Knowledge never traveled.

3/ The fix: every Claude holds an ed25519 keypair, the broker
routes ciphertext (never decrypts), and an MCP server exposes
`send_message` / `list_peers` / `check_messages` to Claude Code.

Now your Claude can ask: "who's seen this?" — another Claude
replies with context, on demand.

4/ Honest limits:
• shares live conversational context, not git state
• both peers need to be online for direct msgs
• WhatsApp/phone gateways are v0.2 roadmap
• no auto-magic — peers only surface info when asked

5/ MIT, E2E (libsodium), self-hostable broker.

repo → github.com/claudemesh/claudemesh
protocol → claudemesh.com/docs

Would love feedback, especially on the trust model.
```

---

## Timing

- **Post to HN**: Tuesday–Thursday, 8am PT / 11am ET for US-hours
  front-page window. Today is Sunday 2026-04-05 — can post Tuesday
  morning, use Sun/Mon to hammer out README polish + fix anything
  that breaks under traffic.
- **Reddit**: cross-post *after* HN lands, 2–4h offset so momentum
  stacks instead of splitting.
- **Twitter**: fire the thread ~30 min after HN post goes up.

---

## Pre-launch checklist (block until green)

- [ ] `https://claudemesh.com` loads, no SSR errors, renders the
      "What is claudemesh?" section correctly
- [ ] `https://github.com/claudemesh/claudemesh` public, README
      rendering, stars enabled
- [ ] `npm install -g @claudemesh/cli` published OR link clearly
      says "install from source" with working instructions
- [ ] `claudemesh.com/docs` resolves (even if thin)
- [ ] `wss://ic.claudemesh.com/ws` accepting connections, no
      capacity crash under 100+ joins/min
- [ ] Dashboard accepts new signups without falling over
- [ ] Someone owns the HN thread for the first 6h — answers within
      15 min per top-level comment

---

*Draft ready for review. Nothing fires until PM green-lights.*
