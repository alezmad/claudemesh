"use client";

import { useTranslation } from "node_modules/@turbostarter/i18n/src/client";

import { cn } from "@turbostarter/ui";
import { buttonVariants } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { pathsConfig } from "~/config/paths";
import { TurboLink } from "~/modules/common/turbo-link";

export const HistoryCta = () => {
  const { t } = useTranslation("common");

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <TurboLink
            href={pathsConfig.apps.image.history}
            className={cn(
              buttonVariants({
                variant: "ghost",
                size: "icon",
                className: "group relative",
              }),
            )}
          >
            <Icons.TextSearch className="text-muted-foreground group-hover:text-foreground size-5" />
          </TurboLink>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>{t("history")}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
