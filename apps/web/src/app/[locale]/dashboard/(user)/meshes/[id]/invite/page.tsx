import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";
import { InviteGenerator } from "~/modules/mesh/invite-generator";

export const generateMetadata = getMetadata({
  title: "Invite to mesh",
  description: "Generate an invite link for this mesh.",
});

export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <DashboardHeader>
        <div>
          <DashboardHeaderTitle>Invite teammate</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            Generate a one-time or reusable invite link.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      <InviteGenerator meshId={id} />
    </>
  );
}
