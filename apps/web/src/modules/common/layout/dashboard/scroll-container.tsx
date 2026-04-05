"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@turbostarter/ui";

interface ScrollContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function ScrollContainer({ children, className }: ScrollContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [_canScrollUp, setCanScrollUp] = useState(false);
  const [_canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    setCanScrollUp(scrollTop > 1);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1);
  }, []);

  // Check on mount, resize, and content changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Initial check
    updateScrollState();

    // Watch for size changes
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);

    // Also observe children for content changes
    const mutationObserver = new MutationObserver(updateScrollState);
    mutationObserver.observe(el, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateScrollState]);

  return (
    <div className={cn("relative flex-1 overflow-hidden", className)}>
      {/* Scroll content - shadows removed, handled by individual components */}
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="h-full overflow-auto"
      >
        <div className="mx-auto w-full max-w-[var(--cm-max-w)] px-4 py-6 md:px-8 md:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}
