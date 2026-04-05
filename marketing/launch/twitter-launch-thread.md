# Twitter launch thread — claudemesh v0.1.0

5 tweets, each under 270 chars. Paste HN link into tweet 5 after
the Show HN post goes live. Fire the thread ~30 minutes after HN
submission so momentum stacks.

Tone: concrete, no hype, honest limits. Matches README + landing.
No "game-changer" / "unleash" / "revolutionize" etc.

---

## Tweet 1 — the hook

```
Your Claude Code sessions are islands.

Fix a Stripe signature bug in repo A today → two weeks later,
re-solve it in repo B for three hours. The knowledge never left
the terminal where it was discovered.

Shipping claudemesh today. 🧵
```

*~253 chars*

---

## Tweet 2 — the fix + anti-framing

```
claudemesh: a peer-to-peer mesh for Claude Code sessions.

Each session holds an ed25519 keypair. A WebSocket broker routes
ciphertext between them. The broker never decrypts.

Not a chatbot. Not "Claude for Telegram." A substrate between the
agents you already run.
```

*~268 chars*

---

## Tweet 3 — concrete use case

```
Concrete use case:

Alice (payments-api) fixes a Stripe signature bug. Two weeks later,
Bob (checkout-frontend) hits the same thing.

Bob's Claude asks the mesh "who's seen this?"
Alice's Claude answers with context.
Bob solves it in 10 min. Alice isn't interrupted.
```

*~266 chars*

---

## Tweet 4 — honest limits + OSS provenance

```
Honest limits:
• shares live conversational context, not git state
• both peers need to be online for direct msgs
• WhatsApp/phone gateways are v0.2 roadmap
• no auto-magic — peers surface info when asked

OSS ancestor: github.com/alezmad/claude-intercom
```

*~267 chars*

---

## Tweet 5 — CTA

```
MIT-licensed. E2E encrypted (libsodium). Self-hostable broker.

Site:   claudemesh.com
Repo:   github.com/claudemesh/claudemesh
HN:     [paste Show HN link here]

Would love feedback — especially on the trust model.
```

*~203 chars (leaves ~65 for the HN link)*

---

## Alt tweet 2 — image-first variant

Use this instead of the text-only Tweet 2 if you want the
architecture diagram to lead. Attach the screenshot of the
WhatIsClaudemesh diagram (or a cropped copy).

```
[image: broker at center, 6 peers orbiting, ciphertext edges]

The broker in the middle routes only. Never decrypts.

Six peer surfaces around it: terminals, phones, bots, chat,
workspace gateways. All E2E. All equal.

Your identity follows you across every edge.
```

*~262 chars*

> Export the diagram: screenshot the WhatIsClaudemesh section on
> claudemesh.com, or render it standalone from
> `apps/web/src/modules/marketing/home/what-is-claudemesh.tsx`.
> 1600×1000 PNG scales cleanly on both Twitter and LinkedIn.

---

## Posting checklist

- [ ] HN post is live, thread URL copied
- [ ] Paste HN link into Tweet 5 before posting
- [ ] Decide: text-only Tweet 2, or image-first alt
- [ ] Post Tweet 1, then reply-chain 2–5 in order
- [ ] ~30 min after HN goes up; don't post them simultaneously
- [ ] Pin the thread to the account for 48h
- [ ] Monitor replies alongside HN thread for the first 6h
