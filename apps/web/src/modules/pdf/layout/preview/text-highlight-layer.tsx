/* eslint-disable @typescript-eslint/no-unnecessary-condition */
"use client";

import { memo, useEffect, useState } from "react";

import { usePdfViewer } from "../../context";

// ============================================================================
// Constants
// ============================================================================

/** Highlight color - yellow for text highlights */
const HIGHLIGHT_COLOR = "rgba(250, 204, 21, 0.4)";

/** Duration in ms before auto-clearing highlights */
const HIGHLIGHT_DURATION_MS = 8000;

// ============================================================================
// Styles
// ============================================================================

/** Injected styles for text span highlighting */
const TEXT_HIGHLIGHT_STYLES = `
.pdf-text-highlight {
  background-color: ${HIGHLIGHT_COLOR} !important;
  border-radius: 2px;
  pointer-events: none;
  animation: pdf-highlight-fade-in 300ms ease-in-out;
}
@keyframes pdf-highlight-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Inject highlight styles into document head (once)
 */
function ensureStylesInjected(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("pdf-text-highlight-styles")) return;

  const style = document.createElement("style");
  style.id = "pdf-text-highlight-styles";
  style.textContent = TEXT_HIGHLIGHT_STYLES;
  document.head.appendChild(style);
}

/**
 * Find text in PDF text layer and apply CSS highlights.
 * Searches the text layer for exact text matches and applies highlight classes.
 *
 * @param container - Parent element containing the PDF viewer
 * @param text - Text phrase to search for and highlight
 * @param pageNumber - Page number where the text should be found
 * @returns Number of spans highlighted
 */
function applyTextHighlights(
  container: Element,
  text: string,
  pageNumber: number,
): number {
  // Find the text layer for this page
  const pageEl = container.querySelector(`[data-page-number="${pageNumber}"]`);
  const textLayer =
    pageEl?.querySelector(".textLayer") ?? container.querySelector(".textLayer");

  if (!textLayer) {
    console.debug("[TextHighlightLayer] No TextLayer found for page", pageNumber);
    return 0;
  }

  const spans = textLayer.querySelectorAll("span");
  const normalizedSearch = text.toLowerCase().trim();
  let highlightCount = 0;

  // Build concatenated text from spans to find matches
  let fullText = "";
  const spanRanges: { start: number; end: number; span: Element }[] = [];

  for (const span of spans) {
    const spanText = span.textContent ?? "";
    const start = fullText.length;
    fullText += spanText;
    spanRanges.push({ start, end: fullText.length, span });
  }

  // Find the search text in the full text
  const normalizedFull = fullText.toLowerCase();
  const foundIndex = normalizedFull.indexOf(normalizedSearch);

  if (foundIndex === -1) {
    console.debug(
      `[TextHighlightLayer] Text not found: "${text.slice(0, 50)}..."`,
    );
    return 0;
  }

  const matchEnd = foundIndex + normalizedSearch.length;

  // Highlight spans that overlap with the match
  for (const { start, end, span } of spanRanges) {
    if (end > foundIndex && start < matchEnd) {
      span.classList.add("pdf-text-highlight");
      span.setAttribute("data-text-highlight", "true");
      highlightCount++;
    }
  }

  return highlightCount;
}

/**
 * Clear all text highlights from the container
 */
function clearTextHighlights(container: Element | null): void {
  if (!container) return;

  const highlighted = container.querySelectorAll("[data-text-highlight]");
  for (const el of highlighted) {
    el.classList.remove("pdf-text-highlight");
    el.removeAttribute("data-text-highlight");
  }
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * TextHighlightLayer - Applies CSS highlights to PDF TextLayer spans based on exact text matches.
 *
 * This component finds and highlights specific text phrases in the PDF viewer.
 * It uses the pdf.js text layer spans and applies CSS classes for highlighting.
 *
 * When `textHighlights` are set in the PdfViewerContext, this component:
 * 1. Finds the text layer spans that contain the search text
 * 2. Applies CSS highlight classes to matching spans
 * 3. Auto-clears highlights after HIGHLIGHT_DURATION_MS
 *
 * The component renders a hidden div to get a ref to the parent container.
 */
export const TextHighlightLayer = memo(function TextHighlightLayer() {
  const { textHighlights, clearTextHighlights: clearFromContext } = usePdfViewer();

  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);

  // Inject styles once on mount
  useEffect(() => {
    ensureStylesInjected();
  }, []);

  // Apply highlights when they change
  useEffect(() => {
    const container = containerRef?.parentElement;

    if (!container || textHighlights.length === 0) {
      if (container) clearTextHighlights(container);
      return;
    }

    // Clear previous highlights
    clearTextHighlights(container);

    // Apply each highlight
    for (const highlight of textHighlights) {
      const count = applyTextHighlights(container, highlight.text, highlight.page);
      console.debug(
        `[TextHighlightLayer] Applied ${count} highlights for "${highlight.text.slice(0, 30)}..."`,
      );
    }

    // Auto-clear after duration
    const timeout = setTimeout(() => {
      clearTextHighlights(container);
      clearFromContext();
    }, HIGHLIGHT_DURATION_MS);

    return () => clearTimeout(timeout);
  }, [textHighlights, containerRef, clearFromContext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const container = containerRef?.parentElement;
      if (container) {
        clearTextHighlights(container);
      }
    };
  }, [containerRef]);

  // Hidden container for ref - renders nothing visible
  return (
    <div
      ref={setContainerRef}
      data-text-highlight-layer
      style={{ display: "none" }}
      aria-hidden="true"
    />
  );
});

TextHighlightLayer.displayName = "TextHighlightLayer";
