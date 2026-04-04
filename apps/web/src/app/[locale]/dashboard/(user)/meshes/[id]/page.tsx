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

export const generateMetadata = getMetadata({
  title: "Mesh",
  description: "Mesh detail.",
});

export default async function MeshPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await handle(api.my.meshes[":id"].$get, {
    schema: getMyMeshResponseSchema,
  })({ param: { id } }).catch(() => null);

  if (!data || !data.mesh) notFound();

  const { mesh, members, invites } = data;
  const activeInvites = invites.filter(
    (i) => !i.revokedAt && new Date(i.expiresAt) > new Date(),
  );

  return (
    <>
      <DashboardHeader>
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <DashboardHeaderTitle>
              <span className="flex items-center gap-3">
                {mesh.name}
                <Badge variant="outline" className="font-mono text-xs">
                  {mesh.slug}
                </Badge>
              </span>
            </DashboardHeaderTitle>
            <DashboardHeaderDescription>
              {mesh.isOwner ? "You own this mesh" : `You're a ${mesh.myRole}`}{" "}
              · tier {mesh.tier} · {mesh.visibility} · {mesh.transport}
            </DashboardHeaderDescription>
          </div>
          <Link
            href={pathsConfig.dashboard.user.meshes.invite(mesh.id)}
            className={buttonVariants({ variant: "default" })}
          >
            Generate invite link
          </Link>
        </div>
      </DashboardHeader>

      <div className="grid gap-8">
        <section className="rounded-lg border">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-medium">
              Members{" "}
              <span className="text-muted-foreground">({members.length})</span>
            </h2>
          </header>
          {members.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              No members yet.
            </p>
          ) : (
            <div className="divide-y">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium">
                      {m.displayName}
                      {m.isMe && (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[10px]"
                        >
                          you
                        </Badge>
                      )}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {m.role}
                    </Badge>
                    {m.revokedAt && (
                      <Badge className="bg-destructive/15 text-destructive text-xs">
                        revoked
                      </Badge>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    joined {new Date(m.joinedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-medium">
              Active invites{" "}
              <span className="text-muted-foreground">
                ({activeInvites.length})
              </span>
            </h2>
          </header>
          {activeInvites.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              No active invites. Generate one to add teammates.
            </p>
          ) : (
            <div className="divide-y">
              {activeInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <code className="bg-muted rounded px-2 py-0.5 text-xs">
                      {inv.token.slice(0, 12)}…
                    </code>
                    <Badge variant="outline" className="text-xs">
                      {inv.role}
                    </Badge>
                    <span className="text-muted-foreground">
                      {inv.usedCount} / {inv.maxUses} used
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
