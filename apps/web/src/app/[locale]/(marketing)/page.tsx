import { Hero } from "~/modules/marketing/home/hero";
import { Surfaces } from "~/modules/marketing/home/surfaces";
import { Pricing } from "~/modules/marketing/home/pricing";
import { LaptopToLaptop } from "~/modules/marketing/home/laptop-to-laptop";
import { Features } from "~/modules/marketing/home/features";
import { MeshVsMcp } from "~/modules/marketing/home/mesh-vs-mcp";
import { MeetsYou } from "~/modules/marketing/home/meets-you";
import { BeyondTerminal } from "~/modules/marketing/home/beyond-terminal";
import { DemoDashboard } from "~/modules/marketing/home/demo-dashboard";
import { WhatIsClaudemesh } from "~/modules/marketing/home/what-is-claudemesh";
import { FAQ } from "~/modules/marketing/home/faq";
import { CallToAction } from "~/modules/marketing/home/cta";
import { MeshStats } from "~/modules/marketing/home/mesh-stats";
import { LatestNewsToaster } from "~/modules/marketing/home/toaster";

// Revalidate the page every 60s so the mesh-stats counter stays fresh
// without hammering the DB. The /api/public/stats endpoint has its own
// 60s in-memory cache too.
export const revalidate = 60;

const HomePage = () => {
  return (
    <div
      className="bg-[var(--cm-bg)] text-[var(--cm-fg)] antialiased"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <Hero />
      <Surfaces />
      <Pricing />
      <LaptopToLaptop />
      <Features />
      <MeshVsMcp />
      <MeetsYou />
      <WhatIsClaudemesh />
      <DemoDashboard />
      <BeyondTerminal />
      <FAQ />
      <CallToAction />
      <MeshStats />
      <LatestNewsToaster />
    </div>
  );
};

export default HomePage;
