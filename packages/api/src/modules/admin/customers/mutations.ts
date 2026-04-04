import { eq } from "@turbostarter/db";
import { creditTransaction, customer } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";
import { HttpStatusCode } from "@turbostarter/shared/constants";
import { generateId, HttpException } from "@turbostarter/shared/utils";

import type { UpdateCreditsInput } from "../../../schema/admin";
import type { UpdateCustomer } from "@turbostarter/db/schema";

export const deleteCustomer = async ({ id }: { id: string }) =>
  db.delete(customer).where(eq(customer.id, id));

export const updateCustomer = async ({
  id,
  data,
}: {
  id: string;
  data: UpdateCustomer;
}) => db.update(customer).set(data).where(eq(customer.id, id));

/**
 * Update customer credits with full transaction audit logging.
 */
export const updateCustomerCredits = async (
  customerId: string,
  input: UpdateCreditsInput,
  adminUserId: string,
) => {
  return db.transaction(async (tx) => {
    // Get current customer
    const [current] = await tx
      .select()
      .from(customer)
      .where(eq(customer.id, customerId));

    if (!current) {
      throw new HttpException(HttpStatusCode.NOT_FOUND, {
        code: "error.customerNotFound",
      });
    }

    // Calculate new balance
    let newBalance: number;
    let transactionType: "admin_grant" | "admin_deduct";
    let transactionAmount: number;

    switch (input.action) {
      case "set":
        transactionAmount = input.amount - current.credits;
        transactionType = transactionAmount >= 0 ? "admin_grant" : "admin_deduct";
        newBalance = input.amount;
        break;
      case "add":
        transactionAmount = input.amount;
        transactionType = "admin_grant";
        newBalance = current.credits + input.amount;
        break;
      case "deduct":
        if (current.credits < input.amount) {
          throw new HttpException(HttpStatusCode.BAD_REQUEST, {
            code: "error.insufficientCredits",
            message: `Cannot deduct ${input.amount} credits. Current balance: ${current.credits}`,
          });
        }
        transactionAmount = -input.amount;
        transactionType = "admin_deduct";
        newBalance = current.credits - input.amount;
        break;
    }

    // Update customer credits
    await tx
      .update(customer)
      .set({
        credits: newBalance,
        updatedAt: new Date(),
      })
      .where(eq(customer.id, customerId));

    // Log transaction
    await tx.insert(creditTransaction).values({
      id: generateId(),
      customerId,
      amount: transactionAmount,
      type: transactionType,
      reason: input.reason ?? `Admin ${input.action}: ${input.amount} credits`,
      balanceAfter: newBalance,
      createdBy: adminUserId,
    });

    return {
      previousBalance: current.credits,
      newBalance,
      action: input.action,
      amount: input.amount,
    };
  });
};
