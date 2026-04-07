ALTER TABLE "mesh"."file" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mesh"."file" ADD COLUMN "owner_pubkey" text;--> statement-breakpoint
CREATE TABLE "mesh"."file_key" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"peer_pubkey" text NOT NULL,
	"sealed_key" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by_pubkey" text
);
--> statement-breakpoint
ALTER TABLE "mesh"."file_key" ADD CONSTRAINT "file_key_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "mesh"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_key_file_peer_idx" ON "mesh"."file_key" ("file_id","peer_pubkey");
