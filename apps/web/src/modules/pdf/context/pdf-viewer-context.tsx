"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type {
  NavigationEntry,
  PdfViewerActions,
  PdfViewerState,
  PreciseCitation,
  TextHighlight,
} from "@turbostarter/ai/pdf/types";
import type { ReactNode } from "react";

// ============================================================================
// Context Types
// ============================================================================

/** Navigation request to be consumed by PageSync */
export interface PendingNavigation {
  page: number;
  embeddingId?: string;
  animate?: boolean;
}

interface PdfViewerContextValue extends PdfViewerState, PdfViewerActions {
  /** Pending navigation request (consumed by PageSync, then cleared) */
  pendingNavigation: PendingNavigation | null;
  /** Clear the pending navigation after it's been processed */
  clearPendingNavigation: () => void;
  /** Text highlights from highlightText tool calls */
  textHighlights: TextHighlight[];
  /** Add a citation from highlightText tool call */
  addTextHighlight: (citation: PreciseCitation) => void;
  /** Update highlight rects after text search resolves */
  updateTextHighlightRects: (id: string, rects: DOMRect[], found: boolean) => void;
  /** Clear all text highlights (e.g., on new message) */
  clearTextHighlights: () => void;
}

// ============================================================================
// Context
// ============================================================================

const PdfViewerContext = createContext<PdfViewerContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface PdfViewerProviderProps {
  children: ReactNode;
  /** Initial page to display */
  initialPage?: number;
}

export function PdfViewerProvider({
  children,
  initialPage = 1,
}: PdfViewerProviderProps) {
  // State
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [zoomLevel, _setZoomLevel] = useState(1);
  const [scrollPosition, _setScrollPosition] = useState(0);
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const [history, setHistory] = useState<NavigationEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const [textHighlights, setTextHighlights] = useState<TextHighlight[]>([]);

  // Actions
  const navigateTo = useCallback(
    (options: { page: number; embeddingId?: string; animate?: boolean }) => {
      const { page, embeddingId, animate = true } = options;

      // Add to history
      const entry: NavigationEntry = {
        page,
        embeddingId,
        timestamp: Date.now(),
      };

      setHistory((prev) => {
        // If we're in the middle of history, truncate forward entries
        const newHistory =
          historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
        return [...newHistory, entry];
      });
      setHistoryIndex((prev) => prev + 1);

      // Set highlight for HighlightLayer
      setActiveHighlight(embeddingId ?? null);

      // Set pending navigation for PageSync to consume
      // PageSync will call lector's jumpToPage and update currentPage
      setPendingNavigation({ page, embeddingId, animate });
    },
    [historyIndex],
  );

  const clearPendingNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  const goBack = useCallback(() => {
    if (historyIndex <= 0) return;

    const prevIndex = historyIndex - 1;
    const entry = history[prevIndex];
    if (!entry) return;

    setHistoryIndex(prevIndex);
    setCurrentPage(entry.page);
    setActiveHighlight(entry.embeddingId ?? null);
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;

    const nextIndex = historyIndex + 1;
    const entry = history[nextIndex];
    if (!entry) return;

    setHistoryIndex(nextIndex);
    setCurrentPage(entry.page);
    setActiveHighlight(entry.embeddingId ?? null);
  }, [history, historyIndex]);

  const clearHighlight = useCallback(() => {
    setActiveHighlight(null);
  }, []);

  // Text highlight actions (for highlightText tool)
  const addTextHighlight = useCallback((citation: PreciseCitation) => {
    setTextHighlights((prev) => [
      ...prev,
      {
        id: citation.citationId,
        text: citation.text,
        page: citation.page,
        rects: [], // Populated when page renders
        found: false,
      },
    ]);
  }, []);

  const updateTextHighlightRects = useCallback(
    (id: string, rects: DOMRect[], found: boolean) => {
      setTextHighlights((prev) =>
        prev.map((h) => (h.id === id ? { ...h, rects, found } : h)),
      );
    },
    [],
  );

  const clearTextHighlights = useCallback(() => {
    setTextHighlights([]);
  }, []);

  // Memoized context value
  const value = useMemo<PdfViewerContextValue>(
    () => ({
      // State
      currentPage,
      zoomLevel,
      scrollPosition,
      activeHighlight,
      history,
      historyIndex,
      pendingNavigation,
      textHighlights,
      // Actions
      navigateTo,
      goBack,
      goForward,
      clearHighlight,
      clearPendingNavigation,
      setCurrentPage,
      addTextHighlight,
      updateTextHighlightRects,
      clearTextHighlights,
    }),
    [
      currentPage,
      zoomLevel,
      scrollPosition,
      activeHighlight,
      history,
      historyIndex,
      pendingNavigation,
      textHighlights,
      navigateTo,
      goBack,
      goForward,
      clearHighlight,
      clearPendingNavigation,
      addTextHighlight,
      updateTextHighlightRects,
      clearTextHighlights,
    ],
  );

  return (
    <PdfViewerContext.Provider value={value}>
      {children}
    </PdfViewerContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function usePdfViewer(): PdfViewerContextValue {
  const context = useContext(PdfViewerContext);
  if (!context) {
    throw new Error("usePdfViewer must be used within a PdfViewerProvider");
  }
  return context;
}

/**
 * Check if we can go back in navigation history
 */
export function useCanGoBack(): boolean {
  const { historyIndex } = usePdfViewer();
  return historyIndex > 0;
}

/**
 * Check if we can go forward in navigation history
 */
export function useCanGoForward(): boolean {
  const { history, historyIndex } = usePdfViewer();
  return historyIndex < history.length - 1;
}
