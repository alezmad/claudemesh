"use client";

import { useCanGoBack, useCanGoForward, usePdfViewer } from "../context";

/**
 * Convenience hook for PDF navigation controls.
 * Combines navigation state and actions in one place.
 */
export function usePdfNavigation() {
  const { goBack, goForward, navigateTo, history, historyIndex } =
    usePdfViewer();
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();

  return {
    // Actions
    goBack,
    goForward,
    navigateTo,
    // State
    canGoBack,
    canGoForward,
    historyLength: history.length,
    currentIndex: historyIndex,
  };
}
