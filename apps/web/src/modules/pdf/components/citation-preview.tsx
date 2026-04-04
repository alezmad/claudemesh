/* eslint-disable i18next/no-literal-string */
"use client";

import { cn } from "@turbostarter/ui";
import { Skeleton } from "@turbostarter/ui-web/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { useEmbedding } from "../hooks";

import type { Citation } from "@turbostarter/ai/pdf/types";
import type { ReactNode } from "react";

// ============================================================================
// Types
// ============================================================================

export interface CitationPreviewProps {
  /** Citation data with excerpt and metadata */
  citation: Citation;
  /** The citation element to wrap (trigger) */
  children: ReactNode;
  /** Side to show the tooltip (default: top) */
  side?: "top" | "bottom" | "left" | "right";
  /** Optional className for content styling */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format relevance score as percentage
 */
function formatRelevance(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Truncate excerpt to max length with ellipsis
 */
function truncateExcerpt(excerpt: string, maxLength = 120): string {
  if (excerpt.length <= maxLength) return excerpt;
  return excerpt.substring(0, maxLength).trim() + "...";
}

// ============================================================================
// Citation Preview Component
// ============================================================================

/**
 * Tooltip/popover wrapper showing citation details on hover.
 * Displays page number, relevance score, and excerpt preview.
 * Fetches embedding content if excerpt is not available.
 *
 * @example
 * ```tsx
 * <CitationPreview citation={citation}>
 *   <Citation citation={citation} />
 * </CitationPreview>
 * ```
 */
export function CitationPreview({
  citation,
  children,
  side = "top",
  className,
}: CitationPreviewProps) {
  // Fetch embedding content if excerpt is empty
  const { data: embedding, isLoading } = useEmbedding(
    citation.excerpt ? null : citation.embeddingId,
  );

  // Use citation excerpt if available, otherwise use fetched embedding content
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const excerptText = citation.excerpt || embedding?.content || "";

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={8}
        className={cn(
          "max-w-xs p-3",
          "bg-popover text-popover-foreground",
          "border border-border rounded-lg shadow-lg",
          className,
        )}
      >
        <div className="space-y-2">
          {/* Header with page number and relevance */}
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-muted-foreground">
              Page {citation.pageNumber}
            </span>
            {citation.relevance > 0 && (
              <span
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded-full",
                  citation.relevance >= 0.8
                    ? "bg-green-500/10 text-green-600"
                    : citation.relevance >= 0.5
                      ? "bg-yellow-500/10 text-yellow-600"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {formatRelevance(citation.relevance)} match
              </span>
            )}
          </div>

          {/* Excerpt preview */}
          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : excerptText ? (
            <p className="text-sm text-foreground leading-relaxed">
              "{truncateExcerpt(excerptText)}"
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No excerpt available
            </p>
          )}

          {/* Click hint */}
          <p className="text-xs text-muted-foreground italic">
            Click to jump to source
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default CitationPreview;
