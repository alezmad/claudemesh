"use client";

import { useState } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

export const ThreadMessageLikes = () => {
  const { t } = useTranslation("common");
  const [likeState, setLikeState] = useState<-1 | 0 | 1>(0);

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group/button size-8 rounded-full"
            onClick={() => setLikeState(likeState === 1 ? 0 : 1)}
          >
            <Icons.ThumbsUp
              className={cn(
                "size-3.5 transition-colors",
                likeState === 1
                  ? "text-primary fill-current"
                  : "text-muted-foreground group-hover/button:text-foreground",
              )}
            />
            <span className="sr-only">{t("like")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t("like")}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group/button size-8 rounded-full"
            onClick={() => setLikeState(likeState === -1 ? 0 : -1)}
          >
            <Icons.ThumbsDown
              className={cn(
                "size-3.5 transition-colors",
                likeState === -1
                  ? "text-primary fill-current"
                  : "text-muted-foreground group-hover/button:text-foreground",
              )}
            />
            <span className="sr-only">{t("dislike")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t("dislike")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
