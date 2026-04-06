CREATE TABLE "mesh"."context" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"presence_id" text,
	"peer_name" text,
	"summary" text NOT NULL,
	"files_read" text[] DEFAULT '{}',
	"key_findings" text[] DEFAULT '{}',
	"tags" text[] DEFAULT '{}',
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mesh"."task" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"title" text NOT NULL,
	"assignee" text,
	"claimed_by_name" text,
	"claimed_by_presence" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"tags" text[] DEFAULT '{}',
	"result" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"claimed_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "mesh"."context" ADD CONSTRAINT "context_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."context" ADD CONSTRAINT "context_presence_id_presence_id_fk" FOREIGN KEY ("presence_id") REFERENCES "mesh"."presence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesh"."task" ADD CONSTRAINT "task_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."task" ADD CONSTRAINT "task_claimed_by_presence_presence_id_fk" FOREIGN KEY ("claimed_by_presence") REFERENCES "mesh"."presence"("id") ON DELETE no action ON UPDATE no action;