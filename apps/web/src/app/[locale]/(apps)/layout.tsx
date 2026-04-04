import { SidebarInset, SidebarProvider } from "@turbostarter/ui-web/sidebar";

import { AppsSidebar } from "~/modules/common/layout/sidebar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppsSidebar />
      <SidebarInset className="relative h-dvh shrink grow sm:h-[calc(100dvh-1rem)]">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
