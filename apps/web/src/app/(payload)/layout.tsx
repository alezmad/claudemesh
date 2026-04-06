import "@payloadcms/next/css";
import type { ReactNode } from "react";

export const metadata = {
  title: "CMS — claudemesh",
};

export default function PayloadLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
