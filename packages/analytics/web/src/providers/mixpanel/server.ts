import Mixpanel from "mixpanel";

import { NodeEnv } from "@turbostarter/shared/constants";
import { logger } from "@turbostarter/shared/logger";

import { env } from "./env";

import type { AnalyticsProviderServerStrategy } from "@turbostarter/analytics";

let client: Mixpanel.Mixpanel | null = null;

const getClient = () => {
  if (client) {
    return client;
  }

  client = Mixpanel.init(env.NEXT_PUBLIC_MIXPANEL_TOKEN, {
    debug: env.NODE_ENV === NodeEnv.DEVELOPMENT,
  });

  return client;
};

export const { track } = {
  track: (event, properties) => {
    try {
      const mixpanel = getClient();
      mixpanel.track(event, properties ?? {});
    } catch (error) {
      logger.warn("Failed to track Mixpanel event: ", error);
    }
  },
} satisfies AnalyticsProviderServerStrategy;
