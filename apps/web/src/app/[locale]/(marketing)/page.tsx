import { Hero } from "~/modules/marketing/home/hero";
import { Surfaces } from "~/modules/marketing/home/surfaces";
import { Pricing } from "~/modules/marketing/home/pricing";
import { LaptopToLaptop } from "~/modules/marketing/home/laptop-to-laptop";
import { Features } from "~/modules/marketing/home/features";
import { MeetsYou } from "~/modules/marketing/home/meets-you";
import { FAQ } from "~/modules/marketing/home/faq";
import { CallToAction } from "~/modules/marketing/home/cta";
import { LatestNewsToaster } from "~/modules/marketing/home/toaster";

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
      <MeetsYou />
      <FAQ />
      <CallToAction />
      <LatestNewsToaster />
    </div>
  );
};

export default HomePage;
