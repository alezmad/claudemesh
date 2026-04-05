import { cn } from "@turbostarter/ui";

import { appConfig } from "~/config/app";

interface BaseLayoutProps {
  readonly locale: string;
  readonly children: React.ReactNode;
}

export const BaseLayout = ({ children, locale }: BaseLayoutProps) => {
  return (
    <html lang={locale} className={cn("cm-root")}>
      <body
        suppressHydrationWarning
        className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center font-sans antialiased"
        data-theme={appConfig.theme.color}
      >
        {children}
      </body>
    </html>
  );
};
