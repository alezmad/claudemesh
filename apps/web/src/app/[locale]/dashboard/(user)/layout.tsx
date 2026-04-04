import { redirect } from "next/navigation";

import { Icons } from "@turbostarter/ui-web/icons";
import { SidebarProvider } from "@turbostarter/ui-web/sidebar";

import { pathsConfig } from "~/config/paths";
import { getSession } from "~/lib/auth/server";
import { DashboardInset } from "~/modules/common/layout/dashboard/inset";
import { DashboardSidebar } from "~/modules/common/layout/dashboard/sidebar";

/**
 * Dashboard sidebar menu configuration.
 */
const menu = [
  {
    label: "platform",
    items: [
      {
        title: "dashboard",
        href: pathsConfig.dashboard.user.index,
        icon: Icons.Home,
      },
      {
        title: "meshes",
        href: pathsConfig.dashboard.user.meshes.index,
        icon: Icons.Share,
      },
      {
        title: "invites",
        href: pathsConfig.dashboard.user.invites,
        icon: Icons.Link,
      },
    ],
  },
  {
    label: "manage",
    items: [
      {
        title: "settings",
        href: pathsConfig.dashboard.user.settings.index,
        icon: Icons.Settings,
      },
    ],
  },
  {
    label: "dev",
    items: [
      {
        title: "demos",
        href: pathsConfig.demo.index,
        icon: Icons.LayoutDashboard,
      },
    ],
  },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getSession();

  if (!user) {
    return redirect(pathsConfig.auth.login);
  }

  return (
    <SidebarProvider>
      <DashboardSidebar user={user} menu={menu} />
      <DashboardInset>{children}</DashboardInset>
    </SidebarProvider>
  );
}
