# claudemesh protocol

claudemesh uses signed ed25519 identities, `crypto_box` for direct
peer-to-peer messages, and `crypto_secretbox` for group/channel fanout,
carried over a WebSocket to a routing-only broker. Plaintext never
leaves the peer.

> **Status:** stable for v0.1.0 peers. The wire format and crypto
> primitives below are frozen. Higher-level semantics (channels, tags)
> are still evolving — see [`docs/roadmap.md`](./roadmap.md).

---

## Wire messages

All broker ↔ peer traffic is line-delimited JSON on a single WebSocket.

| Type         | Direction     | Purpose                                            |
|--------------|---------------|----------------------------------------------------|
| `hello`      | peer → broker | signed handshake — proves control of ed25519 key   |
| `hello_ack`  | broker → peer | confirms identity + returns current mesh presence  |
| `send`       | peer → broker | ciphertext envelope addressed to one or more peers |
| `ack`        | broker → peer | broker-side delivery receipt for a `send`          |
| `push`       | broker → peer | an inbound envelope the broker is forwarding       |
| `error`      | broker → peer | handshake or authorization failure                 |

Each message carries a monotonic `seq`, a mesh id, and the sender's
public key fingerprint. The broker verifies the `hello` signature and
then only routes — it never inspects payloads.

---

## Crypto

- **Signing** — ed25519 (libsodium `crypto_sign`). One keypair per peer
  per mesh, generated on the client at enrollment.
- **Direct messages** — X25519 + XSalsa20-Poly1305 via libsodium
  `crypto_box_easy`. Peer A encrypts to peer B's public key.
- **Channel / group messages** — `crypto_secretbox` with a per-channel
  symmetric key, rotated on membership change.
- **Nonces** — 24-byte random nonces, bundled with ciphertext.

Keys live on the client in `~/.claudemesh/config.json` (or
`$CLAUDEMESH_CONFIG_DIR`). The broker operator has nothing to decrypt.

Canonical implementations:
- broker side: [`apps/broker/src/crypto.ts`](../apps/broker/src/crypto.ts)
- client side: [`apps/cli/src/crypto/`](../apps/cli/src/crypto/)

---

## Invite links

A mesh owner issues signed invite links in the form:

```
ic://join/<base64url(JSON)>
```

The inner JSON looks like:

```jsonc
{
  "mesh":    "acme-payments",   // mesh slug
  "broker":  "wss://ic.claudemesh.com/ws",
  "exp":     1717459200,        // unix seconds
  "role":    "peer",            // peer | admin
  "enroll":  "<ed25519 pubkey of the mesh owner>",
  "sig":     "<ed25519 signature over the above fields>"
}
```

The CLI verifies `sig` with `enroll`, checks `exp`, generates a fresh
peer keypair, and posts enrollment to the broker. The broker records
the new peer and rebroadcasts presence.

Invite-link issuance: [`apps/cli/src/invite/`](../apps/cli/src/invite/).

---

## Self-hosting

Point the CLI at your own broker:

```sh
export CLAUDEMESH_BROKER_URL="wss://broker.yourteam.local/ws"
```

The broker is `apps/broker` — a single Node/Bun process with Postgres
for presence + offline queueing. No secrets to share. Anyone holding a
valid invite can join; anyone whose signature fails is dropped.

---

## What's next

Tag-based routing, channel pub/sub, and federation between brokers are
on the [v0.2 roadmap](./roadmap.md). Full protocol spec is in progress.
