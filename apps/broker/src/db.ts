/**
 * Postgres client re-export for the broker.
 *
 * The broker shares a Postgres instance with apps/web, accessed through
 * the same Drizzle schema defined in @turbostarter/db. Importing the
 * `db` binding from `@turbostarter/db/server` gives us a pre-wired
 * client with the `mesh` pgSchema tables already in scope.
 */
export { db } from "@turbostarter/db/server";
export { schema } from "@turbostarter/db/schema";
