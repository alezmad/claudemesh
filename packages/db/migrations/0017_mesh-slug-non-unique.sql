-- Drop global uniqueness on mesh.slug.
--
-- Identity for a mesh is mesh.id (opaque, generated). The slug is now
-- cosmetic only — derived from the display name at creation time and
-- embedded in invite payloads for debugging/display. Two meshes may
-- freely share a slug.
--
-- Safe to run on populated tables: the constraint is removed, no data
-- is altered, no rows are locked for content changes.

ALTER TABLE "mesh"."mesh" DROP CONSTRAINT IF EXISTS "mesh_slug_unique";
