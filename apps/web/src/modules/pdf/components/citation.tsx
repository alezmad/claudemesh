"use client";

import { cn } from "@turbostarter/ui";
import { Icons } from "@turbostarter/ui-web/icons";

import { usePdfViewer } from "../context/pdf-viewer-context";

import type { Citation } from "@turbostarter/ai/pdf/types";

// ============================================================================
// Types
// ============================================================================

export interface CitationProps {
  /** Citation data from parsed AI response */
  citation: Citation;
  /** Optional className for styling overrides */
  className?: string;
}

// ============================================================================
// Citation Component
// ============================================================================

/**
 * Clickable inline citation component displayed as [1], [2], etc.
 * Clicking navigates to the cited page and highlights the source.
 *
 * @example
 * ```tsx
 * <Citation citation={{ index: 1, pageNumber: 5, embeddingId: "abc123", ... }} />
 * // Renders: [1] - clickable, navigates to page 5
 * ```
 */
export function Citation({ citation, className }: CitationProps) {
  const { navigateTo, activeHighlight, clearHighlight } = usePdfViewer();

  // Check if this citation is currently active
  const isActive = activeHighlight === citation.embeddingId;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Toggle behavior: if already active, deactivate; otherwise activate
    if (isActive) {
      clearHighlight();
    } else {
      navigateTo({
        page: citation.pageNumber,
        embeddingId: citation.embeddingId,
        animate: true,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isActive}
      className={cn(
        "inline-flex items-center justify-center",
        "min-w-[1.5rem] h-5 px-1.5",
        "text-xs font-semibold",
        "border rounded-full",
        "cursor-pointer",
        "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-1",
        "transition-all duration-150",
        "align-text-top",
        // Active vs inactive states
        isActive
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/30",
        className,
      )}
      aria-label={`Citation ${citation.index}, page ${citation.pageNumber}${isActive ? " (active)" : ""}`}
      title={isActive ? "Click to deactivate" : `Go to page ${citation.pageNumber}`}
    >
      <Icons.FileText className="size-3 mr-0.5" aria-hidden />
      <span>{citation.index}</span>
    </button>
  );
}

export default Citation;
