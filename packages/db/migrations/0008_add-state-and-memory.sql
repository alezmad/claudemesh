CREATE TABLE "mesh"."memory" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"content" text NOT NULL,
	"tags" text[] DEFAULT '{}',
	"remembered_by" text,
	"remembered_by_name" text,
	"remembered_at" timestamp DEFAULT now() NOT NULL,
	"forgotten_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mesh"."state" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_presence" text,
	"updated_by_name" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mesh"."memory" ADD CONSTRAINT "memory_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."memory" ADD CONSTRAINT "memory_remembered_by_member_id_fk" FOREIGN KEY ("remembered_by") REFERENCES "mesh"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesh"."state" ADD CONSTRAINT "state_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "state_mesh_key_idx" ON "mesh"."state" USING btree ("mesh_id","key");--> statement-breakpoint
ALTER TABLE "mesh"."memory" ADD COLUMN IF NOT EXISTS "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_search_idx" ON "mesh"."memory" USING gin("search_vector");