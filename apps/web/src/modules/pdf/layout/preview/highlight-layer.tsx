/* eslint-disable @typescript-eslint/no-unnecessary-condition */
"use client";

import { memo, useCallback, useEffect, useRef } from "react";

import { usePdfViewer } from "../../context";
import { useEmbedding } from "../../hooks";
import { useCitationUnit } from "../../hooks/use-citation-unit";

import type { BoundingBox } from "../../hooks/use-citation-unit";

// ============================================================================
// Constants
// ============================================================================

/** Duration in ms before auto-clearing the highlight */
const HIGHLIGHT_DURATION_MS = 5000;

/** Minimum word match percentage to consider a span relevant (legacy fallback) */
const MIN_MATCH_PERCENTAGE = 0.25;

/** CSS class for primary highlight (exact citation - violet) */
const HIGHLIGHT_PRIMARY_CLASS = "pdf-citation-primary";

/** CSS class for secondary highlight (context - yellow) */
const HIGHLIGHT_SECONDARY_CLASS = "pdf-citation-secondary";

/** Legacy class name for backward compatibility */
const HIGHLIGHT_CLASS = "pdf-citation-highlight";

/** Data attribute to mark highlighted spans */
const HIGHLIGHT_ATTR = "data-citation-highlight";

// ============================================================================
// Styles
// ============================================================================

/** Injected styles for text span highlighting (two-level: primary + secondary) */
const HIGHLIGHT_STYLES = `
/* Secondary highlight - yellow/amber for context */
.${HIGHLIGHT_SECONDARY_CLASS} {
  background-color: rgba(250, 204, 21, 0.25) !important;
  border-radius: 2px;
  transition: background-color 300ms ease-in-out;
}

/* Primary highlight - violet for exact citation (overrides secondary) */
.${HIGHLIGHT_PRIMARY_CLASS} {
  background-color: rgba(139, 92, 246, 0.4) !important;
  border-radius: 2px;
  box-shadow: 0 0 6px rgba(139, 92, 246, 0.5);
  transition: background-color 300ms ease-in-out;
}

/* Legacy highlight class (backward compatibility) */
.${HIGHLIGHT_CLASS} {
  background-color: rgba(250, 204, 21, 0.4) !important;
  border-radius: 2px;
  box-shadow: 0 0 4px rgba(250, 204, 21, 0.6);
  transition: background-color 300ms ease-in-out;
}
`;

// ============================================================================
// Utilities - Legacy Word Overlap Matching
// ============================================================================

/**
 * Inject highlight styles into document head (once)
 */
function ensureStylesInjected(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("pdf-highlight-styles")) return;

  const style = document.createElement("style");
  style.id = "pdf-highlight-styles";
  style.textContent = HIGHLIGHT_STYLES;
  document.head.appendChild(style);
}

/**
 * Normalize text for comparison - removes extra whitespace, lowercases
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Get significant words from text (words with 3+ characters)
 */
function getSignificantWords(text: string): Set<string> {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter((w) => w.length >= 3);
  return new Set(words);
}

/**
 * Calculate word overlap percentage between two texts
 */
function calculateWordOverlap(text1: string, text2: string): number {
  const words1 = getSignificantWords(text1);
  const words2 = getSignificantWords(text2);

  if (words1.size === 0 || words2.size === 0) return 0;

  let matchCount = 0;
  for (const word of words1) {
    if (words2.has(word)) matchCount++;
  }

  return matchCount / Math.min(words1.size, words2.size);
}

/**
 * Find text layer spans that match the embedding content and apply highlights
 */
function applyHighlightsToSpans(
  container: Element,
  embeddingContent: string,
): number {
  // Find the TextLayer - it has class "textLayer" from pdfjs
  const textLayers = container.querySelectorAll(".textLayer");
  if (textLayers.length === 0) {
    console.debug("[HighlightLayer] No TextLayer found");
    return 0;
  }

  let highlightCount = 0;

  // Check each text layer
  for (const textLayer of textLayers) {
    const spans = textLayer.querySelectorAll("span");

    // For each span, check if it contains significant words from the embedding
    for (const span of spans) {
      const spanText = span.textContent ?? "";
      if (spanText.trim().length < 3) continue;

      const overlap = calculateWordOverlap(spanText, embeddingContent);
      if (overlap >= MIN_MATCH_PERCENTAGE) {
        span.classList.add(HIGHLIGHT_CLASS);
        span.setAttribute(HIGHLIGHT_ATTR, "true");
        highlightCount++;
      }
    }
  }

  // If no individual spans match, try grouping consecutive spans
  if (highlightCount === 0) {
    for (const textLayer of textLayers) {
      const spans = Array.from(textLayer.querySelectorAll("span"));
      const combinedText = spans.map((s) => s.textContent ?? "").join(" ");

      // Check if the combined text contains significant content from embedding
      const overlap = calculateWordOverlap(combinedText, embeddingContent);
      if (overlap >= MIN_MATCH_PERCENTAGE) {
        // Find contiguous groups that match
        for (let i = 0; i < spans.length; i++) {
          let groupText = "";

          for (let j = i; j < Math.min(i + 10, spans.length); j++) {
            groupText += " " + (spans[j]?.textContent ?? "");

            const groupOverlap = calculateWordOverlap(
              groupText,
              embeddingContent,
            );
            if (groupOverlap >= MIN_MATCH_PERCENTAGE) {
              // Highlight all spans in this group
              for (let k = i; k <= j; k++) {
                const span = spans[k];
                if (span) {
                  span.classList.add(HIGHLIGHT_CLASS);
                  span.setAttribute(HIGHLIGHT_ATTR, "true");
                  highlightCount++;
                }
              }
              break;
            }
          }

          if (highlightCount > 0) break;
        }
      }
    }
  }

  console.debug(`[HighlightLayer] Highlighted ${highlightCount} spans (legacy)`);
  return highlightCount;
}

/**
 * Remove all highlights from the document (clears all highlight classes)
 */
function clearAllHighlights(container: Element | null): void {
  if (!container) return;

  const highlighted = container.querySelectorAll(`[${HIGHLIGHT_ATTR}]`);
  for (const el of highlighted) {
    el.classList.remove(HIGHLIGHT_PRIMARY_CLASS);
    el.classList.remove(HIGHLIGHT_SECONDARY_CLASS);
    el.classList.remove(HIGHLIGHT_CLASS);
    el.removeAttribute(HIGHLIGHT_ATTR);
  }
}

// ============================================================================
// Utilities - Bounding Box to Text Span Highlighting
// ============================================================================

/**
 * Parse percentage value from CSS style string (e.g., "left: 31.1%" -> 31.1)
 */
function parsePercentage(style: string, property: string): number | null {
  const regex = new RegExp(`${property}:\\s*([\\d.]+)%`);
  const match = style.match(regex);
  return match?.[1] ? parseFloat(match[1]) : null;
}

/** Margin settings for highlight levels */
interface HighlightMargins {
  horizontal: number;
  vertical: number;
}

/** Tight margins for primary highlight (exact citation) */
const PRIMARY_MARGINS: HighlightMargins = { horizontal: 1, vertical: 0.5 };

/** Wider margins for secondary highlight (context) */
const SECONDARY_MARGINS: HighlightMargins = { horizontal: 5, vertical: 3 };

/**
 * Check if a span's position overlaps with the bbox region
 * Both bbox (0-1 normalized) and span positions (0-100 percentage) need alignment
 */
function spanOverlapsBbox(
  span: HTMLElement,
  bbox: BoundingBox,
  margins: HighlightMargins = SECONDARY_MARGINS,
): boolean {
  const style = span.getAttribute("style") ?? "";

  // Parse span position from inline style (percentage-based)
  const spanLeft = parsePercentage(style, "left");
  const spanTop = parsePercentage(style, "top");

  if (spanLeft === null || spanTop === null) {
    return false;
  }

  // Convert bbox normalized coords (0-1) to percentage (0-100) for comparison
  const bboxLeft = bbox.x * 100;
  const bboxTop = bbox.y * 100;
  const bboxRight = (bbox.x + bbox.width) * 100;
  const bboxBottom = (bbox.y + bbox.height) * 100;

  const spanInHorizontalRange = spanLeft >= (bboxLeft - margins.horizontal) &&
                                 spanLeft <= (bboxRight + margins.horizontal);
  const spanInVerticalRange = spanTop >= (bboxTop - margins.vertical) &&
                               spanTop <= (bboxBottom + margins.vertical);

  return spanInHorizontalRange && spanInVerticalRange;
}

/** Highlight level for two-tier highlighting */
type HighlightLevel = "primary" | "secondary";

/**
 * Find and highlight text layer spans that fall within a bounding box
 * Supports two-level highlighting: primary (exact citation) and secondary (context)
 */
function applyBboxHighlightsToSpans(
  container: Element,
  bbox: BoundingBox,
  pageNumber: number,
  level: HighlightLevel = "primary",
): number {
  // Find the specific page's text layer
  const pageElement = container.querySelector(`[data-page-number="${pageNumber}"]`);
  const textLayer = pageElement?.querySelector(".textLayer") ??
                    container.querySelector(".textLayer");

  if (!textLayer) {
    console.debug("[HighlightLayer] No TextLayer found for bbox highlight");
    return 0;
  }

  const spans = textLayer.querySelectorAll("span");
  let highlightCount = 0;

  // Select margins and class based on level
  const margins = level === "primary" ? PRIMARY_MARGINS : SECONDARY_MARGINS;
  const highlightClass = level === "primary" ? HIGHLIGHT_PRIMARY_CLASS : HIGHLIGHT_SECONDARY_CLASS;

  for (const span of spans) {
    const spanText = span.textContent ?? "";
    if (spanText.trim().length < 1) continue;

    if (spanOverlapsBbox(span as HTMLElement, bbox, margins)) {
      span.classList.add(highlightClass);
      span.setAttribute(HIGHLIGHT_ATTR, level);
      highlightCount++;
    }
  }

  console.debug(`[HighlightLayer] Highlighted ${highlightCount} spans via bbox (${level})`);
  return highlightCount;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * HighlightLayer - Applies CSS highlights to PDF TextLayer spans based on citations
 *
 * All highlighting is done by applying CSS classes directly to the PDF.js TextLayer
 * span elements, ensuring highlights scroll naturally with the document.
 *
 * Supports two highlight detection modes:
 * 1. Bounding Box (WF-0028): Uses bbox coordinates to find spans within the region
 * 2. Word Overlap (legacy): Falls back to text matching when bbox unavailable
 *
 * When `activeHighlight` is set in the PdfViewerContext, this component:
 * 1. Fetches the citation unit data (or legacy embedding)
 * 2. If bbox available: Finds TextLayer spans within the bounding box region
 * 3. If no bbox: Searches TextLayer for spans with matching text content
 * 4. Applies CSS classes to matching spans for highlighting
 *
 * The highlight auto-clears after 5 seconds.
 */
export const HighlightLayer = memo(function HighlightLayer() {
  const { activeHighlight, clearHighlight } = usePdfViewer();

  // Try citation unit first (WF-0028)
  const { data: citationUnit, isLoading: citationLoading } = useCitationUnit(activeHighlight);

  // Fall back to legacy embedding if citation unit not found
  const shouldFetchEmbedding = Boolean(activeHighlight) && !citationLoading && !citationUnit;
  const { data: embedding } = useEmbedding(shouldFetchEmbedding ? activeHighlight : null);

  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isApplyingHighlightsRef = useRef(false);
  const lastHighlightIdRef = useRef<string | null>(null);

  // Determine which mode to use
  const hasBbox = citationUnit?.bbox != null;
  const fallbackContent = citationUnit?.content ?? embedding?.content;

  // Debug logging for highlight mode selection
  useEffect(() => {
    if (activeHighlight) {
      console.debug("[HighlightLayer] Active highlight:", activeHighlight, {
        citationLoading,
        hasCitationUnit: Boolean(citationUnit),
        hasBbox,
        hasEmbedding: Boolean(embedding),
        fallbackContentPreview: fallbackContent?.slice(0, 50),
      });
    }
  }, [activeHighlight, citationLoading, citationUnit, hasBbox, embedding, fallbackContent]);

  // Ensure styles are injected (used by both bbox and legacy modes)
  useEffect(() => {
    ensureStylesInjected();
  }, []);

  // Apply bbox-based highlights (CSS on text spans within bounding box)
  // Two-level highlighting: secondary (yellow, context) then primary (violet, exact citation)
  // Note: Clearing is handled by the main effect, not here
  const applyBboxHighlights = useCallback(() => {
    const container = containerRef.current?.parentElement;
    if (!container || !citationUnit?.bbox) {
      return;
    }

    // First: Apply secondary highlights (yellow) with wider margins for context
    const secondaryCount = applyBboxHighlightsToSpans(
      container,
      citationUnit.bbox,
      citationUnit.pageNumber,
      "secondary",
    );

    // Second: Apply primary highlights (violet) with tight margins for exact citation
    // This overlays secondary highlights on matching spans (CSS priority handles override)
    const primaryCount = applyBboxHighlightsToSpans(
      container,
      citationUnit.bbox,
      citationUnit.pageNumber,
      "primary",
    );

    console.debug(
      `[HighlightLayer] Two-level highlights: ${primaryCount} primary (violet), ${secondaryCount} secondary (yellow)`,
    );
  }, [citationUnit]);

  // Apply legacy highlights to matching text (word overlap)
  // Note: Clearing is handled by the main effect, not here
  const applyLegacyHighlights = useCallback(() => {
    const container = containerRef.current?.parentElement;
    if (!container || !fallbackContent) {
      console.debug("[HighlightLayer] Legacy mode: no container or content", {
        hasContainer: Boolean(container),
        contentPreview: fallbackContent?.slice(0, 100),
      });
      return;
    }

    console.debug("[HighlightLayer] Applying legacy highlights with content:", fallbackContent.slice(0, 100) + "...");

    // Apply new highlights using word overlap matching
    const count = applyHighlightsToSpans(container, fallbackContent);
    if (count === 0) {
      console.warn("[HighlightLayer] No spans matched for legacy highlight. TextLayers found:", container.querySelectorAll(".textLayer").length);
    }
  }, [fallbackContent]);

  // Apply highlights when data changes (unified for both modes)
  useEffect(() => {
    const container = containerRef.current?.parentElement;

    if (!activeHighlight) {
      // Only clear if we previously had a highlight
      if (lastHighlightIdRef.current !== null) {
        clearAllHighlights(container ?? null);
        lastHighlightIdRef.current = null;
      }
      return;
    }

    // Choose highlight method based on available data
    const applyHighlights = hasBbox ? applyBboxHighlights : applyLegacyHighlights;

    // Wait for condition to be ready
    if (hasBbox && !citationUnit?.bbox) return;
    if (!hasBbox && !fallbackContent) return;

    if (!container) return;

    // Check if this is a NEW highlight (different ID) - only then clear old highlights
    const isNewHighlight = lastHighlightIdRef.current !== activeHighlight;
    if (isNewHighlight) {
      clearAllHighlights(container);
      lastHighlightIdRef.current = activeHighlight;
    }

    // Use ref-based flag to prevent MutationObserver re-triggering across effect runs
    const safeApplyHighlights = () => {
      if (isApplyingHighlightsRef.current) return;
      isApplyingHighlightsRef.current = true;
      try {
        // Don't clear again - just apply (clearing already done above for new highlights)
        applyHighlights();
      } finally {
        // Reset flag after a brief delay to allow DOM to settle
        setTimeout(() => {
          isApplyingHighlightsRef.current = false;
        }, 100);
      }
    };

    // Give the TextLayer time to render after page navigation
    const initialTimeout = setTimeout(safeApplyHighlights, 100);

    // Observe DOM changes in case TextLayer loads later (e.g., lazy loading pages)
    // Only re-apply when NEW TextLayer content is added, not when we modify highlight classes
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver((mutations) => {
      // Check if any mutation added new TextLayer spans (not just class changes)
      const hasNewTextContent = mutations.some((mutation) => {
        // Only care about added nodes
        if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
          return false;
        }
        // Check if added nodes contain TextLayer or span elements
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          const el = node as Element;
          return el.classList.contains("textLayer") ||
                 el.querySelector(".textLayer") !== null ||
                 (el.tagName === "SPAN" && el.closest(".textLayer"));
        });
      });

      if (!hasNewTextContent) return;

      // Debounce to handle multiple rapid mutations
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(safeApplyHighlights, 150);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      clearTimeout(initialTimeout);
      if (debounceTimeout) clearTimeout(debounceTimeout);
      observer.disconnect();
    };
  }, [activeHighlight, hasBbox, citationUnit, fallbackContent, applyBboxHighlights, applyLegacyHighlights]);

  // Auto-clear highlight after duration
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (activeHighlight) {
      timeoutRef.current = setTimeout(() => {
        clearAllHighlights(containerRef.current?.parentElement ?? null);
        clearHighlight();
        timeoutRef.current = null;
      }, HIGHLIGHT_DURATION_MS);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [activeHighlight, clearHighlight]);

  // Cleanup highlights on unmount
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      clearAllHighlights(container?.parentElement ?? null);
    };
  }, []);

  // This component no longer renders any visible elements
  // All highlighting is done via CSS classes on TextLayer spans
  return (
    <div
      ref={containerRef}
      data-highlight-layer
      style={{ display: "none" }}
      aria-hidden="true"
    />
  );
});

HighlightLayer.displayName = "HighlightLayer";
