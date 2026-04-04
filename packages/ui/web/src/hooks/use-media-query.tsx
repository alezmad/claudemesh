import { useEffect, useState } from "react";

import { DEFAULT_BREAKPOINTS } from "@turbostarter/ui";

const getMatches = (query: string): boolean => {
  if (typeof window !== "undefined") {
    return window.matchMedia(query).matches;
  }
  return false;
};

export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    const media = window.matchMedia(query);

    // Sync state with current value after mount
    setMatches(media.matches);

    const listener = () => {
      setMatches(media.matches);
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
    } else {
      media.addListener(listener);
    }

    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", listener);
      } else {
        media.removeListener(listener);
      }
    };
  }, [query]);

  return matches;
};

export const useBreakpoint = (
  breakpoint: keyof typeof DEFAULT_BREAKPOINTS,
  type: "min" | "max" = "min",
) => {
  return useMediaQuery(`(${type}-width: ${DEFAULT_BREAKPOINTS[breakpoint]}px)`);
};
