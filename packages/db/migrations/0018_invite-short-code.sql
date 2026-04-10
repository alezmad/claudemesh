-- Add a short opaque URL-shortener code to mesh invites.
--
-- Purpose: make invite URLs human-friendly (claudemesh.com/i/abc12345)
-- instead of ~400 char base64url payloads. The short code resolves
-- server-side to the existing long token — the broker protocol and
-- canonical signed payload are UNCHANGED.
--
-- This is NOT the v2 invite protocol (see spec
-- .artifacts/specs/2026-04-10-anthropic-vision-meshes-invites.md).
-- It is a backward-compatible URL shortener only. The root_key is
-- still embedded in the underlying long token; v2 will address that
-- in a coordinated broker + CLI + web change.
--
-- Column is nullable so existing invites remain valid without backfill.

ALTER TABLE "mesh"."invite" ADD COLUMN IF NOT EXISTS "code" text;

CREATE UNIQUE INDEX IF NOT EXISTS "invite_code_unique_idx"
  ON "mesh"."invite" ("code")
  WHERE "code" IS NOT NULL;
