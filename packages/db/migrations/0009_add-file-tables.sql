CREATE TABLE "mesh"."file" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_type" text,
	"minio_key" text NOT NULL,
	"tags" text[] DEFAULT '{}',
	"persistent" boolean DEFAULT true NOT NULL,
	"uploaded_by_name" text,
	"uploaded_by_member" text,
	"target_spec" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mesh"."file_access" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"peer_session_pubkey" text,
	"peer_name" text,
	"accessed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mesh"."file" ADD CONSTRAINT "file_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mesh"."file" ADD CONSTRAINT "file_uploaded_by_member_member_id_fk" FOREIGN KEY ("uploaded_by_member") REFERENCES "mesh"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesh"."file_access" ADD CONSTRAINT "file_access_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "mesh"."file"("id") ON DELETE cascade ON UPDATE no action;