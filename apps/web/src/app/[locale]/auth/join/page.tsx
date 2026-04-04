import { notFound, redirect } from "next/navigation";

import { handle } from "@turbostarter/api/utils";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getInvitation, getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { Invitation } from "~/modules/organization/invitations/invitation";
import { InvitationEmailMismatch } from "~/modules/organization/invitations/invitation-email-mismatch";
import { InvitationExpired } from "~/modules/organization/invitations/invitation-expired";

export const generateMetadata = getMetadata({
  title: "organization:join.title",
  description: "organization:join.description",
});

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invitationId?: string; email?: string }>;
}) {
  const { invitationId, email } = await searchParams;

  if (!invitationId) {
    return notFound();
  }

  const { user } = await getSession();

  if (!user) {
    const searchParams = new URLSearchParams();
    searchParams.set("invitationId", invitationId);
    if (email) searchParams.set("email", email);
    searchParams.set(
      "redirectTo",
      `${pathsConfig.auth.join}?${searchParams.toString()}`,
    );
    return redirect(`${pathsConfig.auth.login}?${searchParams.toString()}`);
  }

  const invitation = await getInvitation({ id: invitationId });

  if (invitation) {
    // tactical typecast: Hono RPC inference loses the response shape on this
    // route (no zod validator on the response). Proper fix is to add a
    // getOrganizationResponseSchema to packages/api and wire it into the
    // route's c.json() call.
    const res = (await handle(api.organizations[":id"].$get)({
      param: {
        id: invitation.organizationId,
      },
    })) as { organization: Parameters<typeof Invitation>[0]["organization"] | null };
    const { organization } = res;

    if (!organization) {
      return notFound();
    }

    return <Invitation invitation={invitation} organization={organization} />;
  }

  if (email && user.email !== email) {
    return (
      <InvitationEmailMismatch invitationId={invitationId} email={email} />
    );
  }

  return <InvitationExpired />;
}
