"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

// ============================================================================
// Types
// ============================================================================

interface TextSelectionActionProps {
  onAskAbout: (text: string) => void;
  disabled?: boolean;
}

interface SelectionState {
  text: string;
  x: number;
  y: number;
}

// ============================================================================
// Text Selection Action
// ============================================================================

/**
 * Floating action button that appears when text is selected in the PDF viewer.
 * Clicking "Ask about this" sends the selected text to the chat composer.
 *
 * Uses mouseup event instead of selectionchange to avoid excessive re-renders.
 */
export function TextSelectionAction({
  onAskAbout,
  disabled,
}: TextSelectionActionProps) {
  const { t } = useTranslation("ai");
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  // Handle mouse up to check for selection
  const handleMouseUp = useCallback(() => {
    // Small delay to ensure selection is complete
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();

      if (text && text.length > 3) {
        // Only show for meaningful selections (more than 3 chars)
        const range = sel?.getRangeAt(0);
        const rect = range?.getBoundingClientRect();

        if (rect && rect.width > 0) {
          setSelection({
            text,
            x: rect.left + rect.width / 2,
            y: rect.top - 10,
          });
        }
      }
    });
  }, []);

  // Clear selection when clicking outside
  const handleMouseDown = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // Don't clear if clicking on the action button itself
    if (buttonRef.current?.contains(target)) return;

    setSelection(null);
  }, []);

  // Listen for mouse events
  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [handleMouseUp, handleMouseDown]);

  const handleAskAbout = useCallback(() => {
    if (selection?.text) {
      onAskAbout(selection.text);
      // Clear selection after asking
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    }
  }, [selection, onAskAbout]);

  if (!selection) {
    return null;
  }

  return (
    <div
      ref={buttonRef}
      data-selection-action
      className={cn(
        "fixed z-50 -translate-x-1/2 -translate-y-full",
        "animate-in fade-in-0 zoom-in-95 duration-150"
      )}
      style={{
        left: selection.x,
        top: selection.y,
      }}
    >
      <Button
        size="sm"
        variant="default"
        className="gap-2 shadow-lg"
        onClick={handleAskAbout}
        disabled={disabled}
      >
        <Icons.MessagesSquare className="size-3.5" />
        {t("pdf.selection.askAbout")}
      </Button>
    </div>
  );
}

export default TextSelectionAction;
