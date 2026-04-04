"use client";

import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import * as React from "react";
import { useRef, useState, useEffect } from "react";

import { cn } from "@turbostarter/ui";

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

interface ScrollAreaWithShadowsProps {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}

/**
 * Scroll container with fade indicators.
 * Uses CSS mask-image to fade content at edges when scrollable.
 * No overlay elements = no overflow issues with rounded corners.
 */
function ScrollAreaWithShadows({
  children,
  className,
  maxHeight = "60vh",
}: ScrollAreaWithShadowsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateScrollState = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      setScrollState({
        top: scrollTop > 10,
        bottom: scrollTop + clientHeight < scrollHeight - 10,
      });
    };

    updateScrollState();
    el.addEventListener("scroll", updateScrollState);
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, []);

  // Build mask based on scroll state
  const getMaskStyle = (): React.CSSProperties => {
    const fadeSize = "24px";

    if (scrollState.top && scrollState.bottom) {
      // Fade both edges
      return {
        maskImage: `linear-gradient(to bottom, transparent, black ${fadeSize}, black calc(100% - ${fadeSize}), transparent)`,
        WebkitMaskImage: `linear-gradient(to bottom, transparent, black ${fadeSize}, black calc(100% - ${fadeSize}), transparent)`,
      };
    } else if (scrollState.top) {
      // Fade top only
      return {
        maskImage: `linear-gradient(to bottom, transparent, black ${fadeSize})`,
        WebkitMaskImage: `linear-gradient(to bottom, transparent, black ${fadeSize})`,
      };
    } else if (scrollState.bottom) {
      // Fade bottom only
      return {
        maskImage: `linear-gradient(to bottom, black calc(100% - ${fadeSize}), transparent)`,
        WebkitMaskImage: `linear-gradient(to bottom, black calc(100% - ${fadeSize}), transparent)`,
      };
    }

    // No fade needed
    return {};
  };

  return (
    <div
      ref={scrollRef}
      className={cn(
        "overflow-y-auto scroll-smooth [scrollbar-gutter:stable] transition-[mask-image] duration-200",
        className
      )}
      style={{ maxHeight, ...getMaskStyle() }}
    >
      {children}
    </div>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollAreaWithShadows, ScrollBar };
