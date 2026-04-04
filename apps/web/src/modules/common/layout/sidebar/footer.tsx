"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@turbostarter/ui-web/avatar";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@turbostarter/ui-web/sidebar";

import { authClient } from "~/lib/auth/client";

import { Credits } from "../credits";

export function Footer() {
  const { data } = authClient.useSession();
  const name = data?.user.name ?? "Anonymous";
  const email = data?.user.email ?? "...but maybe not at all?";
  const image = data?.user.image ?? `https://avatar.vercel.sh/${data?.user.id}`;

  return (
    <SidebarFooter>
      <SidebarMenu>
        <Credits />
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar className="size-8">
              <AvatarImage src={image} alt={name} />
              <AvatarFallback>
                {name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs">{email}</span>
            </div>
            <Icons.EllipsisVertical className="ml-auto size-4" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
