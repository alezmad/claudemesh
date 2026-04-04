#!/usr/bin/env tsx
/**
 * Backfill customer records for existing users without them.
 * Run once after deploying the new schema.
 *
 * Usage: pnpm with-env pnpm dlx tsx packages/db/src/scripts/backfill-customers.ts
 */

import { eq, isNull } from "drizzle-orm";

import { generateId } from "@turbostarter/shared/utils";

import { creditTransaction, customer, user } from "../schema";
import { db } from "../server";

const DEFAULT_CREDITS = 100;

async function backfillCustomers() {
  console.log("Starting customer backfill...\n");

  // Find users without customer records using a left join
  const usersWithoutCustomers = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
    })
    .from(user)
    .leftJoin(customer, eq(user.id, customer.userId))
    .where(isNull(customer.id));

  console.log(
    `Found ${usersWithoutCustomers.length} users without customer records\n`,
  );

  if (usersWithoutCustomers.length === 0) {
    console.log("No users to backfill. Done!");
    return;
  }

  let created = 0;
  let errors = 0;

  for (const u of usersWithoutCustomers) {
    const customerId = generateId();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(customer).values({
          id: customerId,
          userId: u.id,
          customerId: `backfill_${u.id}`,
          status: "active",
          plan: "free",
          credits: DEFAULT_CREDITS,
        });

        await tx.insert(creditTransaction).values({
          id: generateId(),
          customerId,
          amount: DEFAULT_CREDITS,
          type: "signup",
          reason: "Backfill: Welcome credits for existing user",
          balanceAfter: DEFAULT_CREDITS,
        });
      });

      console.log(`✓ Created customer for ${u.email} (${u.name})`);
      created++;
    } catch (error) {
      console.error(
        `✗ Failed for ${u.email}:`,
        error instanceof Error ? error.message : error,
      );
      errors++;
    }
  }

  console.log(`\nBackfill complete!`);
  console.log(`  Created: ${created}`);
  console.log(`  Errors: ${errors}`);
}

backfillCustomers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });
