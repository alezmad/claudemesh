import { eq } from "@turbostarter/db";
import { organization } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";

export const getOrganization = async ({ id }: { id: string }) =>
  db.query.organization.findFirst({
    where: eq(organization.id, id),
  });
