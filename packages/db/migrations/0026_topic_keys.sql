-- Per-topic symmetric encryption keys (v0.3.0 phase 2 — schema layer).
--
-- Each topic gets a freshly-generated 32-byte XSalsa20-Poly1305 symmetric
-- key. That key is encrypted once per topic member with libsodium
-- crypto_box (recipient pubkey + sender ephemeral keypair) so only the
-- intended member can decrypt their copy. Server stores ciphertext only;
-- it can no longer read message bodies.
--
-- Writes are versioned via topic_message.body_version:
--   1 = legacy v0.2.0 base64-of-plaintext (still readable)
--   2 = real ciphertext (sealed to the topic key, server-blind)
--
-- Old messages stay v1; new clients send v2. Mention fan-out is already
-- decoupled from ciphertext via the notification table (migration 0025),
-- so /v1/notifications keeps working through the cutover.

ALTER TABLE "mesh"."topic"
  ADD COLUMN IF NOT EXISTS "encrypted_key_pubkey" text;
COMMENT ON COLUMN "mesh"."topic"."encrypted_key_pubkey" IS
  'Ephemeral x25519 sender pubkey used to seal per-member copies of the topic symmetric key. Null = legacy v0.2.0 topic with no encryption.';

ALTER TABLE "mesh"."topic_message"
  ADD COLUMN IF NOT EXISTS "body_version" integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "topic_message_by_version"
  ON "mesh"."topic_message" ("body_version");

CREATE TABLE IF NOT EXISTS "mesh"."topic_member_key" (
  "id" text PRIMARY KEY NOT NULL,
  "topic_id" text NOT NULL REFERENCES "mesh"."topic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "member_id" text NOT NULL REFERENCES "mesh"."member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  /** crypto_box ciphertext of the 32-byte topic key, sealed for this member. */
  "encrypted_key" text NOT NULL,
  /** 24-byte nonce used to seal `encrypted_key`. */
  "nonce" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "rotated_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "topic_member_key_unique"
  ON "mesh"."topic_member_key" ("topic_id", "member_id");

CREATE INDEX IF NOT EXISTS "topic_member_key_by_member"
  ON "mesh"."topic_member_key" ("member_id");
