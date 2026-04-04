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

export default function NewMeshPage() {
  return (
    <>
      <DashboardHeader>
        <div>
          <DashboardHeaderTitle>New mesh</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            One mesh per team, project, or rollout. You can archive it later.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      <div className="max-w-xl">
        <CreateMeshForm />
      </div>
    </>
  );
}
