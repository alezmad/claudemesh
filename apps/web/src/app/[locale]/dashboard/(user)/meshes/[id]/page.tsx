import Link from "next/link";
import { notFound } from "next/navigation";

import { getMyMeshResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { db } from "@turbostarter/db/server";
import { meshTopic } from "@turbostarter/db/schema/mesh";
import { Badge } from "@turbostarter/ui-web/badge";
import { buttonVariants } from "@turbostarter/ui-web/button";
import { and, asc, eq, isNull } from "drizzle-orm";

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

  const topics = await db
    .select({
      id: meshTopic.id,
      name: meshTopic.name,
      description: meshTopic.description,
      visibility: meshTopic.visibility,
    })
    .from(meshTopic)
    .where(and(eq(meshTopic.meshId, id), isNull(meshTopic.archivedAt)))
    .orderBy(asc(meshTopic.name));

  return (
    <>
      <DashboardHeader>
        <div className="flex w-full flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <DashboardHeaderTitle>
              <span className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="truncate">{mesh.name}</span>
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
          <div className="flex w-full gap-2 sm:w-auto">
            <Link
              href={pathsConfig.dashboard.user.meshes.live(mesh.id)}
              className={buttonVariants({
                variant: "outline",
                className: "flex-1 sm:flex-initial",
              })}
            >
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--cm-clay)]" />
              Live
            </Link>
            <Link
              href={pathsConfig.dashboard.user.meshes.invite(mesh.id)}
              className={buttonVariants({
                variant: "default",
                className: "flex-1 sm:flex-initial",
              })}
            >
              <span className="hidden sm:inline">Generate invite link</span>
              <span className="sm:hidden">Invite</span>
            </Link>
          </div>
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
                  className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
              Topics{" "}
              <span className="text-muted-foreground">({topics.length})</span>
            </h2>
          </header>
          {topics.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              No topics yet. Run{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
                claudemesh topic create &lt;name&gt;
              </code>{" "}
              from the CLI.
            </p>
          ) : (
            <div className="divide-y">
              {topics.map((t) => (
                <Link
                  key={t.id}
                  href={pathsConfig.dashboard.user.meshes.topic(mesh.id, t.name)}
                  className="hover:bg-muted/50 flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="font-medium">
                      <span className="text-muted-foreground">#</span>
                      {t.name}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {t.visibility}
                    </Badge>
                  </div>
                  {t.description ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {t.description}
                    </span>
                  ) : null}
                </Link>
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
                  className="flex flex-col gap-1.5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <code className="bg-muted rounded px-2 py-0.5 text-xs">
                      {inv.token.slice(0, 12)}…
                    </code>
                    <Badge variant="outline" className="text-xs">
                      {inv.role}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
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
