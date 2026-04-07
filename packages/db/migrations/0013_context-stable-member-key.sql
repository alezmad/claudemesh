ALTER TABLE "mesh"."context" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "mesh"."context" ADD CONSTRAINT "context_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "mesh"."member"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "context_mesh_member_idx" ON "mesh"."context" ("mesh_id","member_id");
