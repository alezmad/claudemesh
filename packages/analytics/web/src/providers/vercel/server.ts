import { track as vercelTrack } from "@vercel/analytics/server";

import type { AnalyticsProviderServerStrategy } from "@turbostarter/analytics";

export const { track } = {
  track: (event, data) => {
    void vercelTrack(event, data);
  },
} satisfies AnalyticsProviderServerStrategy;
