-- v2 invite protocol + email invites.
--
-- Spec: .artifacts/specs/2026-04-10-anthropic-vision-meshes-invites.md
--
-- Two concerns in one migration (both touch the invite surface):
--
-- 1. v2 invite protocol — the mesh root_key no longer travels in the
--    invite URL. Instead the recipient generates a curve25519 keypair at
--    claim time and sends the pubkey to the broker; the broker seals
--    root_key with crypto_box_seal to that pubkey. The DB captures the
--    protocol version, the canonical signed bytes that the broker
--    re-verifies against mesh.owner_pubkey, and an audit-only record of
--    which recipient pubkey received the sealed key.
--
-- 2. Email invites — admins can send invites to an email address. A
--    pending_invite row tracks the send; when the recipient lands on
--    /i/{code} it is matched to an underlying mesh.invite row (mint on
--    send). acceptedAt / revokedAt capture lifecycle.
--
-- Both additions are backward-compatible: version defaults to 1, new
-- columns are nullable, the new table is independent of existing rows.

ALTER TABLE "mesh"."invite"
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

ALTER TABLE "mesh"."invite"
  ADD COLUMN IF NOT EXISTS "capability_v2" text;

ALTER TABLE "mesh"."invite"
  ADD COLUMN IF NOT EXISTS "claimed_by_pubkey" text;

CREATE TABLE IF NOT EXISTS "mesh"."pending_invite" (
  "id" text PRIMARY KEY NOT NULL,
  "mesh_id" text NOT NULL,
  "email" text NOT NULL,
  "code" text NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "accepted_at" timestamp,
  "revoked_at" timestamp,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "pending_invite_mesh_id_fk"
    FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pending_invite_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "pending_invite_email_idx"
  ON "mesh"."pending_invite" ("email");

CREATE INDEX IF NOT EXISTS "pending_invite_mesh_idx"
  ON "mesh"."pending_invite" ("mesh_id");
