"use client";

import { motion } from "motion/react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@turbostarter/ui-web/accordion";
import { Icons } from "@turbostarter/ui-web/icons";

import { MemoizedMarkdown } from "~/modules/common/markdown/memoized-markdown";

import type { ReasoningUIPart } from "ai";

interface ReasoningMessagePartProps {
  part: ReasoningUIPart;
  reasoning: boolean;
  defaultExpanded?: boolean;
}

export function ReasoningMessagePart({
  part,
  reasoning,
  defaultExpanded = false,
}: ReasoningMessagePartProps) {
  const { t } = useTranslation("common");

  if (!part.text) {
    return null;
  }

  return (
    <div className="w-full">
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultExpanded ? "reasoning" : undefined}
        className="w-full"
      >
        <AccordionItem value="reasoning" className="border-none [&_h3]:my-0">
          <AccordionTrigger
            className={cn(
              "not-prose border-border bg-background rounded-xl border p-3 pr-4 shadow-xs hover:no-underline",
              "data-[state=open]:rounded-b-none",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-muted rounded-lg p-1 md:p-1.5">
                  {reasoning ? (
                    <Icons.Loader className="text-muted-foreground size-3.5 animate-spin md:size-4" />
                  ) : (
                    <Icons.Sparkle className="text-muted-foreground size-3.5 md:size-4" />
                  )}
                </div>
                <h2 className="text-left font-medium">
                  {reasoning
                    ? t("reasoning.inProgress")
                    : t("reasoning.completed")}
                </h2>
              </div>
            </div>
          </AccordionTrigger>

          <AccordionContent className="mt-0 border-0 py-0">
            <div className="rounded-b-xl border border-t-0 px-5 py-3 shadow-xs">
              <div className="text-muted-foreground prose-p:my-1.5 text-sm">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <MemoizedMarkdown id={part.type} content={part.text} />
                </motion.div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
