import { eq } from "@turbostarter/db";
import { account } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

export const deleteAccount = async ({ id }: { id: string }) =>
  db.delete(account).where(eq(account.id, id));
