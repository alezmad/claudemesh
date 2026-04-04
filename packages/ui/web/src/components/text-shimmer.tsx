"use client";

import { motion  } from "framer-motion";
import * as React from "react";

import { cn } from "@turbostarter/ui";

import type {Variants} from "framer-motion";

interface TextShimmerProps {
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}

function TextShimmer({
  children,
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const dynamicSpread = React.useMemo(() => spread, [spread]);

  const variants: Variants = React.useMemo(() => {
    return {
      initial: {
        backgroundPosition: "100% center",
      },
      animate: {
        backgroundPosition: "0% center",
      },
    };
  }, []);

  return (
    <motion.span
      className={cn(
        "relative inline-block bg-clip-text text-transparent",
        "bg-[length:250%_100%,100%_100%]",
        "bg-[linear-gradient(90deg,transparent,var(--tw-gradient-from)_calc(50%-var(--shimmer-spread)),var(--tw-gradient-to)_50%,var(--tw-gradient-from)_calc(50%+var(--shimmer-spread)),transparent),linear-gradient(var(--base-gradient-color),var(--base-gradient-color))]",
        "from-foreground via-foreground/90 to-foreground",
        "[--base-gradient-color:hsl(var(--muted-foreground)/0.5)]",
        "[--shimmer-spread:--spacing(8)]",
        className,
      )}
      style={
        {
          "--shimmer-spread": `${dynamicSpread}rem`,
        } as React.CSSProperties
      }
      initial="initial"
      animate="animate"
      variants={variants}
      transition={{
        duration,
        ease: "linear",
        repeat: Infinity,
      }}
    >
      {children}
    </motion.span>
  );
}

export { TextShimmer };
