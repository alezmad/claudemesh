import Link from "next/link";

import { getMyMeshesResponseSchema } from "@turbostarter/api/schema";
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

export const generateMetadata = getMetadata({
  title: "Meshes",
  description: "Meshes you own or belong to.",
});

export default async function MeshesPage() {
  const { data } = await handle(api.my.meshes.$get, {
    schema: getMyMeshesResponseSchema,
  })({
    query: { page: "1", perPage: "50", sort: JSON.stringify([]) },
  });

  return (
    <>
      <DashboardHeader>
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <DashboardHeaderTitle>Meshes</DashboardHeaderTitle>
            <DashboardHeaderDescription>
              Meshes you own or have joined. Click any to open.
            </DashboardHeaderDescription>
          </div>
          <Link
            href={pathsConfig.dashboard.user.meshes.new}
            className={buttonVariants({ variant: "default" })}
          >
            New mesh
          </Link>
        </div>
      </DashboardHeader>

      {data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground mb-4">
            You haven&apos;t joined any meshes yet.
          </p>
          <Link
            href={pathsConfig.dashboard.user.meshes.new}
            className={buttonVariants({ variant: "default" })}
          >
            Create your first mesh
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map((m) => (
            <Link
              key={m.id}
              href={pathsConfig.dashboard.user.meshes.mesh(m.id)}
              className="group rounded-lg border p-5 transition-colors hover:border-primary hover:bg-muted/30"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="group-hover:text-primary truncate font-medium">
                    {m.name}
                  </h3>
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {m.slug}
                  </p>
                </div>
                <Badge variant="outline" className="flex-shrink-0 text-xs">
                  {m.isOwner ? "owner" : m.myRole}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <Badge variant="secondary" className="text-xs">
                  {m.tier}
                </Badge>
                <span className="text-muted-foreground">
                  {m.memberCount} {m.memberCount === 1 ? "member" : "members"}
                </span>
                {m.archivedAt && (
                  <Badge variant="outline" className="text-xs">
                    archived
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
