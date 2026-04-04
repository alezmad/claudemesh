import { auth } from "@turbostarter/auth/server";
import { and, eq } from "@turbostarter/db";
import { invitation, member, organization } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";
import { HttpStatusCode } from "@turbostarter/shared/constants";
import { HttpException } from "@turbostarter/shared/utils";

import type {
  UpdateMemberPayload,
  UpdateOrganizationPayload,
} from "@turbostarter/auth";

export const deleteOrganization = async ({ id }: { id: string }) =>
  db.delete(organization).where(eq(organization.id, id));

export const updateOrganization = async ({
  id,
  data,
}: {
  id: string;
  data: UpdateOrganizationPayload;
}) => {
  if (typeof data.slug === "string") {
    const current = await db.query.organization.findFirst({
      where: eq(organization.id, id),
      columns: { slug: true },
    });

    if (current?.slug !== data.slug) {
      let check: { status: boolean };
      try {
        check = await auth.api.checkOrganizationSlug({
          body: { slug: data.slug },
        });
      } catch {
        check = { status: false };
      }

      if (!check.status) {
        throw new HttpException(HttpStatusCode.BAD_REQUEST, {
          code: "auth:error.organization.slugNotAvailable",
        });
      }
    }
  }

  return db.update(organization).set(data).where(eq(organization.id, id));
};

export const deleteOrganizationInvitation = async ({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) =>
  db
    .delete(invitation)
    .where(
      and(eq(invitation.id, id), eq(invitation.organizationId, organizationId)),
    );

export const deleteOrganizationMember = async ({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) =>
  db
    .delete(member)
    .where(and(eq(member.id, id), eq(member.organizationId, organizationId)));

export const updateOrganizationMember = async ({
  id,
  data,
}: {
  id: string;
  data: UpdateMemberPayload;
}) => db.update(member).set(data).where(eq(member.id, id));
