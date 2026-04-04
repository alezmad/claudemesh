"use client";

import * as React from "react";

import { Sidebar } from "@turbostarter/ui-web/sidebar";

import { Content } from "./content";
import { Footer } from "./footer";
import { Header } from "./header";

export function AppsSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      <Header />
      <Content />
      <Footer />
    </Sidebar>
  );
}
