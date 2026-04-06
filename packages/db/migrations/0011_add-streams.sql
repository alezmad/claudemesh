CREATE TABLE "mesh"."stream" (
	"id" text PRIMARY KEY NOT NULL,
	"mesh_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mesh"."stream" ADD CONSTRAINT "stream_mesh_id_mesh_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "mesh"."mesh"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "stream_mesh_name_idx" ON "mesh"."stream" USING btree ("mesh_id","name");