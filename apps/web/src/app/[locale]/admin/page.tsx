import * as z from "zod";

import { handle } from "@turbostarter/api/utils";
import { getTranslation } from "@turbostarter/i18n/server";
import { cn } from "@turbostarter/ui";
import { buttonVariants } from "@turbostarter/ui-web/button";
import {
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@turbostarter/ui-web/card";
import { Icons } from "@turbostarter/ui-web/icons";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";
import { TurboLink } from "~/modules/common/turbo-link";

export const generateMetadata = getMetadata({
  title: "admin:home.header.title",
  description: "admin:home.header.description",
});

export default async function AdminPage() {
  const { t, i18n } = await getTranslation({ ns: ["common", "admin"] });

  const adminSummarySchema = z.object({
    users: z.number(),
    organizations: z.number(),
    customers: z.number(),
  });
  const meshSummarySchema = z.object({
    meshes: z.number(),
    activeMeshes: z.number(),
    totalPresences: z.number(),
    activePresences: z.number(),
    messages24h: z.number(),
  });

  const [base, mesh] = await Promise.all([
    handle(api.admin.summary.$get, { schema: adminSummarySchema })(),
    handle(api.admin.summary.mesh.$get, { schema: meshSummarySchema })(),
  ]);

  const nf = new Intl.NumberFormat(i18n.language);

  const cards = [
    {
      key: "users" as const,
      title: t("common:users"),
      description: t("home.summary.users"),
      href: pathsConfig.admin.users.index,
      value: base.users,
    },
    {
      key: "organizations" as const,
      title: t("common:organizations"),
      description: t("home.summary.organizations"),
      href: pathsConfig.admin.organizations.index,
      value: base.organizations,
    },
    {
      key: "customers" as const,
      title: t("common:customers"),
      description: t("home.summary.customers"),
      href: pathsConfig.admin.customers.index,
      value: base.customers,
    },
    {
      key: "meshes" as const,
      title: "Meshes",
      description: `${nf.format(mesh.activeMeshes)} active`,
      href: pathsConfig.admin.meshes.index,
      value: mesh.meshes,
    },
    {
      key: "sessions" as const,
      title: "Sessions",
      description: `${nf.format(mesh.activePresences)} live now`,
      href: pathsConfig.admin.sessions.index,
      value: mesh.totalPresences,
    },
    {
      key: "messages" as const,
      title: "Messages (24h)",
      description: "Routed through the broker",
      href: pathsConfig.admin.audit.index,
      value: mesh.messages24h,
    },
  ];

  return (
    <>
      <DashboardHeader>
        <div>
          <DashboardHeaderTitle>
            {t("admin:home.header.title")}
          </DashboardHeaderTitle>
          <DashboardHeaderDescription>
            {t("admin:home.header.description")}
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>

      <nav className="@container/stats w-full">
        <ul className="grid grid-cols-1 gap-4 @lg/stats:grid-cols-2 @2xl/stats:grid-cols-3">
          {cards.map((card) => (
            <li key={card.key}>
              <TurboLink
                href={card.href}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "text-muted-foreground h-full w-full flex-col items-start justify-between gap-3 p-0",
                )}
              >
                <CardHeader className="w-full">
                  <div className="flex w-full items-center justify-between gap-3">
                    <CardTitle className="text-foreground truncate">
                      {card.title}
                    </CardTitle>
                    <Icons.ChevronRight className="mt-0.5 size-4" />
                  </div>
                  <CardDescription className="whitespace-normal">
                    {card.description}
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <span className="text-foreground font-mono text-4xl font-bold tracking-tight">
                    {nf.format(card.value)}
                  </span>
                </CardFooter>
              </TurboLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
