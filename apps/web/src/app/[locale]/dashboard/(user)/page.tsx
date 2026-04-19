import { redirect } from "next/navigation";

import {
  getMyInvitesIncomingResponseSchema,
  getMyMeshesResponseSchema,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";

import { appConfig } from "~/config/app";
import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { InvitationsSection } from "~/modules/dashboard/universe/invitations";
import { MeshesGrid } from "~/modules/dashboard/universe/meshes-grid";
import { UniverseWelcome } from "~/modules/dashboard/universe/welcome";

export const generateMetadata = getMetadata({
  title: "Your universe",
  description: "Meshes, peers, and invitations — all in one place.",
});

export default async function UniversePage() {
  const { user } = await getSession();
  const name = user?.name ?? "there";

  const [{ data: meshes }, { incoming }] = await Promise.all([
    handle(api.my.meshes.$get, {
      schema: getMyMeshesResponseSchema,
    })({
      query: { page: "1", perPage: "50", sort: JSON.stringify([]) },
    }),
    handle(api.my.invites.incoming.$get, {
      schema: getMyInvitesIncomingResponseSchema,
    })(),
  ]);

  const activeMeshes = meshes.filter((m) => !m.archivedAt);

  // First-time onboarding: brand-new user with nothing waiting → create flow.
  if (activeMeshes.length === 0 && incoming.length === 0) {
    redirect(`${pathsConfig.dashboard.user.meshes.new}?onboarding=1`);
  }

  return (
    <div className="@container relative h-full p-6 md:p-10">
      {/* Subtle radial backdrop, matching marketing hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 15% -5%, rgba(217,119,87,0.08), transparent 70%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-[1400px]">
        <UniverseWelcome
          name={name}
          meshCount={activeMeshes.length}
          inviteCount={incoming.length}
        />

        <InvitationsSection
          incoming={incoming}
          appBaseUrl={appConfig.url ?? "https://claudemesh.com"}
        />

        <MeshesGrid meshes={activeMeshes} />
      </div>
    </div>
  );
}
