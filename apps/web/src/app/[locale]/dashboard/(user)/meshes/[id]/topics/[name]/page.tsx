import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createDashboardApiKey } from "@turbostarter/api/modules/mesh/api-key-auth";
import { getMyMeshResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { db } from "@turbostarter/db/server";
import { mesh, meshMember, meshTopic } from "@turbostarter/db/schema/mesh";
import { Badge } from "@turbostarter/ui-web/badge";
import { buttonVariants } from "@turbostarter/ui-web/button";
import { and, asc, eq, isNull } from "drizzle-orm";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";
import { TopicChatPanel } from "~/modules/mesh/topic-chat-panel";

export const generateMetadata = getMetadata({
  title: "Topic",
  description: "Chat in a topic.",
});

export default async function TopicChatPage({
  params,
}: {
  params: Promise<{ id: string; name: string }>;
}) {
  const { id, name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  const session = await getSession();
  if (!session?.user?.id) redirect(pathsConfig.auth.login);

  const data = await handle(api.my.meshes[":id"].$get, {
    schema: getMyMeshResponseSchema,
  })({ param: { id } }).catch(() => null);
  if (!data?.mesh) notFound();

  // Resolve the caller's member id — owner gets the oldest member row in the
  // mesh as their identity, otherwise pick the explicit membership.
  let memberId: string | null = null;
  if (data.mesh.isOwner) {
    const [m] = await db
      .select({ id: meshMember.id })
      .from(meshMember)
      .where(and(eq(meshMember.meshId, id), isNull(meshMember.revokedAt)))
      .orderBy(asc(meshMember.joinedAt))
      .limit(1);
    memberId = m?.id ?? null;
  } else {
    const [m] = await db
      .select({ id: meshMember.id })
      .from(meshMember)
      .where(
        and(
          eq(meshMember.meshId, id),
          eq(meshMember.userId, session.user.id),
          isNull(meshMember.revokedAt),
        ),
      )
      .limit(1);
    memberId = m?.id ?? null;
  }
  if (!memberId) notFound();

  const [topic] = await db
    .select({
      id: meshTopic.id,
      name: meshTopic.name,
      description: meshTopic.description,
      visibility: meshTopic.visibility,
    })
    .from(meshTopic)
    .where(
      and(
        eq(meshTopic.meshId, id),
        eq(meshTopic.name, name),
        isNull(meshTopic.archivedAt),
      ),
    )
    .limit(1);
  if (!topic) notFound();

  // Mint a fresh dashboard apikey for this user, scoped to read+send on
  // this single topic. Lives 24h and is shown ONCE in the page HTML.
  const key = await createDashboardApiKey({
    meshId: id,
    memberId,
    label: `dashboard:${session.user.id.slice(0, 8)}:${name}`,
    capabilities: ["read", "send"],
    topicScopes: [name],
  });

  return (
    <>
      <DashboardHeader>
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <DashboardHeaderTitle>
              <span className="flex items-center gap-3">
                <span className="text-muted-foreground">#</span>
                {topic.name}
                <Badge variant="outline" className="font-mono text-xs">
                  {topic.visibility}
                </Badge>
              </span>
            </DashboardHeaderTitle>
            <DashboardHeaderDescription>
              {topic.description ?? `Topic in ${data.mesh.name}.`}
            </DashboardHeaderDescription>
          </div>
          <Link
            href={pathsConfig.dashboard.user.meshes.mesh(id)}
            className={buttonVariants({ variant: "outline" })}
          >
            ← Mesh
          </Link>
        </div>
      </DashboardHeader>

      <TopicChatPanel
        topicName={topic.name}
        topicId={topic.id}
        meshSlug={data.mesh.slug}
        apiKeySecret={key.secret}
        apiKeyExpiresAt={key.expiresAt.toISOString()}
      />
    </>
  );
}
