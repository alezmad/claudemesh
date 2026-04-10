import { HeroWithMesh } from "~/modules/marketing/home/hero-with-mesh";
import { Features } from "~/modules/marketing/home/features";
import { WhereMeshFits } from "~/modules/marketing/home/where-mesh-fits";
import { WhatIsClaudemesh } from "~/modules/marketing/home/what-is-claudemesh";
import { Timeline } from "~/modules/marketing/home/timeline";
import { Pricing } from "~/modules/marketing/home/pricing";
import { FAQ } from "~/modules/marketing/home/faq";
import { CallToAction } from "~/modules/marketing/home/cta";
import { MeshStats } from "~/modules/marketing/home/mesh-stats";
import { LatestNewsToaster } from "~/modules/marketing/home/toaster";

export const revalidate = 60;

const HomePage = () => {
  return (
    <div
      className="bg-[var(--cm-bg)] text-[var(--cm-fg)] antialiased"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <HeroWithMesh />
      <Features />
      <WhereMeshFits />
      <WhatIsClaudemesh />
      <Timeline />
      <Pricing />
      <FAQ />
      <CallToAction />
      <MeshStats />
      <LatestNewsToaster />
    </div>
  );
};

export default HomePage;
