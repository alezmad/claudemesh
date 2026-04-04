import { PdfLayout } from "~/modules/pdf/layout/layout";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  return <PdfLayout id={id}>{children}</PdfLayout>;
}
