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

import type { PdfMessage } from "@turbostarter/ai/pdf/types";

// ============================================================================
// Types
// ============================================================================

interface CopyWithCitationsProps {
  message: PdfMessage;
}

// ============================================================================
// Helpers
// ============================================================================

const CITATION_REGEX = /\[\[cite:([a-zA-Z0-9]+):(\d+)\]\]/g;

/**
 * Format message content with readable citations.
 * Replaces [[cite:embeddingId:pageNum]] with [p.X] format.
 */
function formatContentWithCitations(content: string): string {
  const seenPages = new Map<string, number>();
  let citationIndex = 0;

  return content.replace(
    CITATION_REGEX,
    (_match, _embeddingId: string, pageNumStr: string) => {
      const pageNumber = pageNumStr;

      // Track unique citations
      if (!seenPages.has(pageNumber)) {
        citationIndex++;
        seenPages.set(pageNumber, citationIndex);
      }

      return `[p.${pageNumber}]`;
    }
  );
}

// ============================================================================
// Animation
// ============================================================================

const transition = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.8 },
  transition: { duration: 0.1, ease: "easeInOut" as const },
};

// ============================================================================
// Component
// ============================================================================

/**
 * Copy button that formats citations as readable page references.
 * Transforms [[cite:xxx:5]] into [p.5] for clean clipboard content.
 */
export function CopyWithCitations({ message }: CopyWithCitationsProps) {
  const { t } = useTranslation("common");
  const { copied, copy } = useCopy();

  const handleCopy = () => {
    const rawContent = getMessageTextContent(message);
    const formattedContent = formatContentWithCitations(rawContent);
    void copy(formattedContent);
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group/button size-8 rounded-full"
            onClick={handleCopy}
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
}

export default CopyWithCitations;
