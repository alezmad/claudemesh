-- Notifications — write-time mention fan-out (v0.3.0 phase 1).
--
-- Replaces the regex-on-decoded-ciphertext scan in /v1/notifications and
-- the dashboard MentionsSection. Lets us drop the
-- `convert_from(decode(ciphertext, 'base64'), 'UTF8') ~* @name` query that
-- breaks the moment ciphertext stops being base64-of-UTF8 (i.e. the
-- moment per-topic encryption lands in v0.3.0 phase 2).
--
-- One row per (recipient_member, topic_message). Idempotent ON CONFLICT
-- on the unique pair; if the broker re-fans a message after a crash the
-- recipient sees one notification, not two.
--
-- Server-side mention extraction happens in POST /v1/messages and the
-- broker's WS message handler. Both extract @-tokens from the body
-- BEFORE encryption (the only point at which the server can read it),
-- match against the topic's member roster, and insert a row per match.

CREATE TABLE IF NOT EXISTS "mesh"."notification" (
  "id" text PRIMARY KEY NOT NULL,
  "mesh_id" text NOT NULL REFERENCES "mesh"."mesh"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "topic_id" text NOT NULL REFERENCES "mesh"."topic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "message_id" text NOT NULL REFERENCES "mesh"."topic_message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipient_member_id" text NOT NULL REFERENCES "mesh"."member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sender_member_id" text NOT NULL REFERENCES "mesh"."member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" text NOT NULL DEFAULT 'mention',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "read_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_unique"
  ON "mesh"."notification" ("message_id", "recipient_member_id");

CREATE INDEX IF NOT EXISTS "notification_by_recipient_unread"
  ON "mesh"."notification" ("recipient_member_id", "created_at" DESC)
  WHERE "read_at" IS NULL;

CREATE INDEX IF NOT EXISTS "notification_by_recipient"
  ON "mesh"."notification" ("recipient_member_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "notification_by_mesh"
  ON "mesh"."notification" ("mesh_id", "created_at" DESC);

-- Backfill existing v0.2.0 messages so the new table has history. Safe
-- to run multiple times (ON CONFLICT DO NOTHING). The regex matches the
-- same shape as the in-app autocomplete + render: @-prefixed token with
-- a non-word boundary on both sides (or string edges).
--
-- We skip messages that fail to decode — defensive against any non-base64
-- ciphertext that may have slipped in via future writers.
INSERT INTO "mesh"."notification"
  ("id", "mesh_id", "topic_id", "message_id", "recipient_member_id",
   "sender_member_id", "kind", "created_at")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  t."mesh_id",
  m."topic_id",
  m."id",
  recipient."id",
  m."sender_member_id",
  'mention',
  m."created_at"
FROM "mesh"."topic_message" m
INNER JOIN "mesh"."topic" t ON t."id" = m."topic_id"
INNER JOIN "mesh"."member" recipient
  ON recipient."mesh_id" = t."mesh_id"
  AND recipient."revoked_at" IS NULL
  AND recipient."id" <> m."sender_member_id"
WHERE
  -- Only scan messages that look like base64-of-UTF8. Defensive guard
  -- against a future writer storing binary ciphertext — convert_from
  -- would otherwise raise and abort the whole migration.
  m."ciphertext" ~ '^[A-Za-z0-9+/=]+$'
  AND length(m."ciphertext") > 0
  AND length(m."ciphertext") % 4 = 0
  AND convert_from(decode(m."ciphertext", 'base64'), 'UTF8') ~* (
    '(^|\s|[^A-Za-z0-9_-])@'
    || regexp_replace(recipient."display_name", '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
    || '($|[^A-Za-z0-9_-])'
  )
ON CONFLICT ("message_id", "recipient_member_id") DO NOTHING;
