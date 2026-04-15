import { HeroWithMesh } from "~/modules/marketing/home/hero-with-mesh";

export default function FccPreviewPage() {
  return (
    <div
      className="bg-[var(--cm-bg)] text-[var(--cm-fg)] antialiased"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <HeroWithMesh />
    </div>
  );
}
