"use client";

import { useTranslation } from "@turbostarter/i18n";
import { buttonVariants } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

import { pathsConfig } from "~/config/paths";
import { TurboLink } from "~/modules/common/turbo-link";

const HomePage = () => {
  const { t } = useTranslation("common");

  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          {t("home.title", { defaultValue: "Welcome to TurboStarter" })}
        </h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          {t("home.description", { defaultValue: "The fastest way to build your next SaaS. Authentication, billing, database, and UI components — all pre-configured and ready to go." })}
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <TurboLink
            href={pathsConfig.auth.login}
            className={buttonVariants({ size: "lg" })}
          >
            {t("home.getStarted", { defaultValue: "Get Started" })}
            <Icons.ArrowRight className="ml-2 size-4" />
          </TurboLink>
          <TurboLink
            href="https://turbostarter.dev/docs"
            className={buttonVariants({ variant: "outline", size: "lg" })}
            target="_blank"
          >
            {t("home.documentation", { defaultValue: "Documentation" })}
          </TurboLink>
        </div>
      </div>
    </main>
  );
};

export default HomePage;
