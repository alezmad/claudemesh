import { getMetadata } from "~/lib/metadata";

export const generateMetadata = getMetadata({
  title: "ai:image.title",
  description: "ai:image.description",
});

export default function ImageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="@container relative flex h-full flex-col items-center contain-layout">
      {children}
    </div>
  );
}
