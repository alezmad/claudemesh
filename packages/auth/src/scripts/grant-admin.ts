/**
 * Grants admin privileges to a user by email.
 *
 * Usage:
 *   pnpm admin:grant <email>
 *
 * Resolved via packages/auth/package.json → root package.json alias.
 * Flips user.role to "admin" via BetterAuth's admin plugin convention
 * (role column, not a custom isAdmin boolean).
 */
import { eq } from "@turbostarter/db";
import * as schema from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";
import { logger } from "@turbostarter/shared/logger";

import { UserRole } from "../types";

const email = process.argv[2];

if (!email) {
  logger.error("Usage: pnpm admin:grant <email>");
  process.exit(1);
}

const rows = await db
  .update(schema.user)
  .set({ role: UserRole.ADMIN })
  .where(eq(schema.user.email, email))
  .returning({
    id: schema.user.id,
    email: schema.user.email,
    role: schema.user.role,
  });

if (rows.length === 0) {
  logger.error(`No user found with email: ${email}`);
  process.exit(1);
}

const updated = rows[0]!;
logger.info(
  `✓ Granted admin to ${updated.email} (id: ${updated.id}, role: ${updated.role})`,
);
process.exit(0);
