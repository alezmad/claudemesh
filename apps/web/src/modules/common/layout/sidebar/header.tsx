import { Icons } from "@turbostarter/ui-web/icons";
import { SidebarHeader } from "@turbostarter/ui-web/sidebar";

import { TurboLink } from "~/modules/common/turbo-link";

export const Header = () => {
  return (
    <SidebarHeader>
      <TurboLink
        target="_blank"
        href="https://turbostarter.dev/ai"
        className="flex items-center gap-3 p-2 transition-[padding] group-data-[collapsible=icon]:p-0.5"
      >
        <Icons.Logo className="text-primary h-8 transition-[width,height]" />
        <Icons.LogoText className="text-foreground h-4 group-data-[collapsible=icon]:hidden" />
      </TurboLink>
    </SidebarHeader>
  );
};
