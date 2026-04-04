import Link from "next/link";
import { redirect } from "next/navigation";

import { getMyMeshesResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { Badge } from "@turbostarter/ui-web/badge";
import { buttonVariants } from "@turbostarter/ui-web/button";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";

export const generateMetadata = getMetadata({
  title: "Dashboard",
  description: "Your meshes.",
});

export default async function DashboardHomePage() {
  const { data } = await handle(api.my.meshes.$get, {
    schema: getMyMeshesResponseSchema,
  })({
    query: { page: "1", perPage: "6", sort: JSON.stringify([]) },
  });

  // First-time onboarding: 0-mesh user → bounce to create
  if (data.length === 0) {
    redirect(`${pathsConfig.dashboard.user.meshes.new}?onboarding=1`);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Your meshes</h1>
        <p className="text-muted-foreground text-sm">
          Open one to see its members, generate invites, or share it.
        </p>
      </div>
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
              <Badge variant="outline" className="text-xs">
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
            </div>
          </Link>
        ))}
      </div>
      <div className="flex gap-3">
        <Link
          href={pathsConfig.dashboard.user.meshes.index}
          className={buttonVariants({ variant: "outline" })}
        >
          All meshes
        </Link>
        <Link
          href={pathsConfig.dashboard.user.meshes.new}
          className={buttonVariants({ variant: "default" })}
        >
          New mesh
        </Link>
      </div>
    </div>
  );
}
