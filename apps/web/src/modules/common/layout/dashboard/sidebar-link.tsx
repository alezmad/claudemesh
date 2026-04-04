"use client";

import { useParams, usePathname } from "next/navigation";
import { memo } from "react";

import { SidebarMenuButton, useSidebar } from "@turbostarter/ui-web/sidebar";

import { pathsConfig } from "~/config/paths";
import { TurboLink } from "~/modules/common/turbo-link";

interface SidebarLinkProps
  extends React.ComponentProps<typeof SidebarMenuButton> {
  href: string;
}

export const SidebarLink = memo<SidebarLinkProps>(
  ({ href, children, ...props }) => {
    const { setOpenMobile } = useSidebar();

    const pathname = usePathname();
    const params = useParams();

    const normalizedPathname = pathname.replace(
      `/${params.locale?.toString()}`,
      "",
    );

    return (
      <SidebarMenuButton
        asChild
        isActive={
          [
            pathsConfig.admin.index,
            pathsConfig.dashboard.user.index,
            ...(params.organization
              ? [
                  pathsConfig.dashboard.organization(
                    params.organization.toString(),
                  ).index,
                ]
              : []),
          ].includes(href)
            ? normalizedPathname === href
            : normalizedPathname.startsWith(href)
        }
        {...props}
      >
        <TurboLink href={href} onClick={() => setOpenMobile(false)}>
          {children}
        </TurboLink>
      </SidebarMenuButton>
    );
  },
);
