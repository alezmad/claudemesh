import { getMetadata } from "~/lib/metadata";

export const generateMetadata = getMetadata({
  title: "ai:pdf.title",
  description: "ai:pdf.description",
});

export default function PdfLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container relative flex h-full flex-col items-center contain-layout">
      {children}
    </div>
  );
}
