import { track as trackEvent } from "@vercel/analytics";
import { Analytics } from "@vercel/analytics/react";

import type { AnalyticsProviderClientStrategy } from "@turbostarter/analytics";

export const { Provider, track, identify, reset } = {
  Provider: ({ children }) => {
    return (
      <>
        {children}
        <Analytics />
      </>
    );
  },
  track: trackEvent,
  identify: () => {
    // Vercel Web Analytics doesn't expose identify() on the client
  },
  reset: () => {
    // Vercel Web Analytics doesn't expose reset() on the client
  },
} satisfies AnalyticsProviderClientStrategy;
