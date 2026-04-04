import Link from "next/link";

import { getMyInvitesResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { Badge } from "@turbostarter/ui-web/badge";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";

export const generateMetadata = getMetadata({
  title: "Invites",
  description: "Invites you've issued.",
});

export default async function InvitesPage() {
  const { sent } = await handle(api.my.invites.$get, {
    schema: getMyInvitesResponseSchema,
  })();

  return (
    <>
      <DashboardHeader>
        <div>
          <DashboardHeaderTitle>Invites</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            Invite links you&apos;ve issued across all your meshes.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      {sent.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            You haven&apos;t issued any invites yet. Open a mesh and generate
            one.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Mesh</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Uses</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sent.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3">
                    {inv.meshId ? (
                      <Link
                        href={pathsConfig.dashboard.user.meshes.mesh(inv.meshId)}
                        className="group flex flex-col gap-0.5"
                      >
                        <span className="group-hover:text-primary font-medium underline underline-offset-4">
                          {inv.meshName ?? "—"}
                        </span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {inv.meshSlug ?? "—"}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{inv.role}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {inv.usedCount} / {inv.maxUses}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {inv.revokedAt ? (
                      <Badge className="bg-destructive/15 text-destructive text-xs">
                        revoked
                      </Badge>
                    ) : new Date(inv.expiresAt) < new Date() ? (
                      <Badge variant="outline" className="text-xs">
                        expired
                      </Badge>
                    ) : inv.usedCount >= inv.maxUses ? (
                      <Badge variant="outline" className="text-xs">
                        exhausted
                      </Badge>
                    ) : (
                      <Badge className="bg-success/15 text-success text-xs">
                        active
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
