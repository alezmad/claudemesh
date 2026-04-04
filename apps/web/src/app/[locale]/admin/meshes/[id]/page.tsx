import { notFound } from "next/navigation";

import { getMeshResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { Badge } from "@turbostarter/ui-web/badge";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";

export const generateMetadata = getMetadata({
  title: "Mesh detail · Admin",
  description: "Members, presences, invites, audit events for a mesh.",
});

export default async function MeshDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await handle(api.admin.meshes[":id"].$get, {
    schema: getMeshResponseSchema,
  })({ param: { id } }).catch(() => null);

  if (!data || !data.mesh) notFound();

  const { mesh, members, presences, invites, auditEvents } = data;

  return (
    <>
      <DashboardHeader>
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
            Owner: {mesh.ownerName ?? "—"} · {mesh.ownerEmail ?? "—"} · tier{" "}
            {mesh.tier} · transport {mesh.transport} · visibility{" "}
            {mesh.visibility}
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>

      <div className="grid gap-8">
        <Section
          title="Members"
          count={members.length}
          empty="No members yet."
        >
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Display name</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Pubkey</th>
                <th className="px-3 py-2 font-medium">Joined</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-medium">{m.displayName}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{m.role}</Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                    {m.peerPubkey.slice(0, 12)}…
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {m.lastSeenAt
                      ? new Date(m.lastSeenAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {m.revokedAt ? (
                      <Badge className="bg-destructive/15 text-destructive">
                        revoked
                      </Badge>
                    ) : (
                      <Badge className="bg-success/15 text-success">
                        active
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section
          title="Live presences"
          count={presences.length}
          empty="No active sessions."
        >
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Peer</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">PID</th>
                <th className="px-3 py-2 font-medium">CWD</th>
                <th className="px-3 py-2 font-medium">Last ping</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {presences.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium">
                    {p.displayName ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="secondary"
                      className={
                        p.disconnectedAt
                          ? "bg-muted/50 text-muted-foreground"
                          : p.status === "working"
                            ? "bg-primary/15 text-primary"
                            : p.status === "dnd"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-muted text-muted-foreground"
                      }
                    >
                      {p.disconnectedAt ? "disconnected" : p.status}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                    {p.pid}
                  </td>
                  <td className="text-muted-foreground max-w-xs truncate px-3 py-2 font-mono text-xs">
                    {p.cwd}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {new Date(p.lastPingAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section
          title="Invites"
          count={invites.length}
          empty="No invites issued."
        >
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Token</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Uses</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                    {inv.token.slice(0, 12)}…
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{inv.role}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {inv.usedCount} / {inv.maxUses}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    {inv.revokedAt ? (
                      <Badge className="bg-destructive/15 text-destructive">
                        revoked
                      </Badge>
                    ) : new Date(inv.expiresAt) < new Date() ? (
                      <Badge variant="outline">expired</Badge>
                    ) : (
                      <Badge className="bg-success/15 text-success">
                        active
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section
          title="Last 50 audit events"
          count={auditEvents.length}
          empty="No events yet."
        >
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {auditEvents.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted-foreground px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {e.eventType}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                    {e.actorPeerId?.slice(0, 12) ?? "—"}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                    {e.targetPeerId?.slice(0, 12) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        <Badge variant="outline" className="font-mono text-xs">
          {count}
        </Badge>
      </header>
      {count === 0 ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-sm">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}
