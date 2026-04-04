"use client";

import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

import { usePdfNavigation } from "../hooks/use-pdf-navigation";

/**
 * Back/Forward navigation controls for PDF viewer.
 * Compact toolbar-style buttons for history navigation.
 */
export function NavigationControls() {
  const { goBack, goForward, canGoBack, canGoForward } = usePdfNavigation();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={goBack}
        disabled={!canGoBack}
        aria-label="Go back"
      >
        <Icons.ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={goForward}
        disabled={!canGoForward}
        aria-label="Go forward"
      >
        <Icons.ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
