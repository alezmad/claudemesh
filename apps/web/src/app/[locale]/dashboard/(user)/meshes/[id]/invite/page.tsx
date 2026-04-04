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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { id } = await params;
  const { onboarding } = await searchParams;
  const isOnboarding = onboarding === "1";

  return (
    <>
      {isOnboarding && (
        <div className="border-primary/40 bg-primary/5 mb-6 rounded-lg border p-5">
          <h2 className="text-primary mb-1 text-lg font-medium">
            🎉 Mesh created
          </h2>
          <p className="mb-2 text-sm leading-relaxed">
            Now generate your first invite link to share with a teammate — or
            use it yourself to join this mesh from another laptop. Your
            teammate runs{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-xs">
              claudemesh join &lt;link&gt;
            </code>{" "}
            in their terminal.
          </p>
        </div>
      )}
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
