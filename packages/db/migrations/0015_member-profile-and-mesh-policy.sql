-- Member profile columns: roleTag, defaultGroups, messageMode, dashboardUserId
ALTER TABLE "mesh"."member" ADD COLUMN "role_tag" text;--> statement-breakpoint
ALTER TABLE "mesh"."member" ADD COLUMN "default_groups" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "mesh"."member" ADD COLUMN "message_mode" text DEFAULT 'push';--> statement-breakpoint
ALTER TABLE "mesh"."member" ADD COLUMN "dashboard_user_id" text;--> statement-breakpoint
CREATE INDEX "member_dashboard_user_idx" ON "mesh"."member" ("dashboard_user_id");--> statement-breakpoint

-- Mesh policy: selfEditable (which profile fields members can self-edit)
ALTER TABLE "mesh"."mesh" ADD COLUMN "self_editable" jsonb DEFAULT '{"displayName":true,"roleTag":true,"groups":true,"messageMode":true}'::jsonb;--> statement-breakpoint

-- Invite preset: pre-configured profile values applied to new members on join
ALTER TABLE "mesh"."invite" ADD COLUMN "preset" jsonb DEFAULT '{}'::jsonb;
