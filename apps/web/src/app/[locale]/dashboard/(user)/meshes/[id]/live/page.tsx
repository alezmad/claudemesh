import Link from "next/link";
import { notFound } from "next/navigation";

import { getMyMeshResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { Badge } from "@turbostarter/ui-web/badge";
import { buttonVariants } from "@turbostarter/ui-web/button";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";
import { LiveStreamPanel } from "~/modules/mesh/live-stream-panel";
import { PeerGraphPanel } from "~/modules/mesh/peer-graph-panel";
import { ResourcePanel } from "~/modules/mesh/resource-panel";
import { StateTimelinePanel } from "~/modules/mesh/state-timeline-panel";

export const generateMetadata = getMetadata({
  title: "Live mesh",
  description: "Real-time situational awareness of your mesh.",
});

export default async function LiveMeshPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Authz gate — same endpoint the detail page uses
  const data = await handle(api.my.meshes[":id"].$get, {
    schema: getMyMeshResponseSchema,
  })({ param: { id } }).catch(() => null);

  if (!data || !data.mesh) notFound();
  const { mesh } = data;

  return (
    <>
      <DashboardHeader>
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <DashboardHeaderTitle>
              <span className="flex items-center gap-3">
                {mesh.name}
                <Badge variant="outline" className="font-mono text-xs">
                  live
                </Badge>
              </span>
            </DashboardHeaderTitle>
            <DashboardHeaderDescription>
              Real-time view of presences and envelope routing across this
              mesh. Broker sees ciphertext only.
            </DashboardHeaderDescription>
          </div>
          <Link
            href={pathsConfig.dashboard.user.meshes.mesh(mesh.id)}
            className={buttonVariants({ variant: "outline" })}
          >
            ← Mesh detail
          </Link>
        </div>
      </DashboardHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PeerGraphPanel meshId={id} />
        <LiveStreamPanel meshId={id} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StateTimelinePanel meshId={id} />
        <ResourcePanel meshId={id} />
      </div>
    </>
  );
}
