-- Threaded replies on topic messages (v0.3.1).
--
-- Adds a self-FK column so any topic message can be marked as a reply to a
-- previous message in the same topic. ON DELETE SET NULL because deleting
-- a parent message shouldn't ripple-delete the children — the thread just
-- becomes "in reply to a deleted message".
--
-- Index supports the cheap backlink lookup: "give me all replies to X".

ALTER TABLE "mesh"."topic_message"
  ADD COLUMN IF NOT EXISTS "reply_to_id" text
    REFERENCES "mesh"."topic_message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "topic_message_by_reply_to"
  ON "mesh"."topic_message" ("reply_to_id");
