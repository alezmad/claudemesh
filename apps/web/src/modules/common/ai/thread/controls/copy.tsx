"use client";

import { AnimatePresence, motion } from "motion/react";

import { getMessageTextContent } from "@turbostarter/ai";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { useCopy } from "~/modules/common/hooks/use-copy";

import type { UIMessage } from "@ai-sdk/react";

const transition = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.8 },
  transition: { duration: 0.1, ease: "easeInOut" as const },
};

interface ThreadMessageCopyProps<MESSAGE extends UIMessage = UIMessage> {
  message: MESSAGE;
}

export const ThreadMessageCopy = <MESSAGE extends UIMessage = UIMessage>({
  message,
}: ThreadMessageCopyProps<MESSAGE>) => {
  const { t } = useTranslation("common");
  const { copied, copy } = useCopy();

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group/button size-8 rounded-full"
            onClick={() => copy(getMessageTextContent(message))}
          >
            <div className="relative size-3.5">
              <AnimatePresence mode="wait" initial={false}>
                {copied ? (
                  <motion.div
                    key="check"
                    {...transition}
                    className="absolute inset-0"
                  >
                    <Icons.Check className="text-muted-foreground group-hover/button:text-foreground size-3.5" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="copy"
                    {...transition}
                    className="absolute inset-0"
                  >
                    <Icons.Copy className="text-muted-foreground group-hover/button:text-foreground size-3.5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className="sr-only">{t("copy")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t("copy")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
