"use client";

import { SidebarInset } from "@turbostarter/ui-web/sidebar";

import { DashboardActionBar } from "./action-bar";
import { ScrollContainer } from "./scroll-container";

export const DashboardInset = ({ children }: { children: React.ReactNode }) => {
  return (
    <SidebarInset className="relative flex h-dvh flex-col sm:h-[calc(100dvh-1rem)]">
      <DashboardActionBar />
      <ScrollContainer>
        {children}
      </ScrollContainer>
    </SidebarInset>
  );
};
