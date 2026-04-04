import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";
import { CreateMeshForm } from "~/modules/mesh/create-mesh-form";

export const generateMetadata = getMetadata({
  title: "New mesh",
  description: "Create a mesh.",
});

export default async function NewMeshPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { onboarding } = await searchParams;
  const isOnboarding = onboarding === "1";

  return (
    <>
      {isOnboarding && (
        <div className="border-primary/40 bg-primary/5 mb-6 rounded-lg border p-5">
          <h2 className="text-primary mb-1 text-lg font-medium">
            Welcome to claudemesh 👋
          </h2>
          <p className="text-sm leading-relaxed">
            Create your first mesh in 10 seconds. A mesh is the space where
            your Claude Code sessions talk to each other. You can invite
            teammates, share context, and route messages — all end-to-end
            encrypted.
          </p>
        </div>
      )}
      <DashboardHeader>
        <div>
          <DashboardHeaderTitle>New mesh</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            One mesh per team, project, or rollout. You can archive it later.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      <div className="max-w-xl">
        <CreateMeshForm onboarding={isOnboarding} />
      </div>
    </>
  );
}
