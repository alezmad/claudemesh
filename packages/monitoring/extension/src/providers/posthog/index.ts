import { PostHog } from "posthog-js/dist/module.no-external";
import { v7 as uuidv7 } from "uuid";

import { env } from "./env";

import type { MonitoringProviderStrategy } from "@turbostarter/monitoring";

const posthog = new PostHog();

export async function getSharedDistinctId() {
  const stored = await chrome.storage.local.get(["posthog_distinct_id"]);
  if (stored.posthog_distinct_id) {
    return stored.posthog_distinct_id as string;
  }

  const distinctId = uuidv7();
  await chrome.storage.local.set({ posthog_distinct_id: distinctId });
  return distinctId;
}

const init = async () => {
  if (posthog.__loaded) {
    return;
  }

  const distinctID = await getSharedDistinctId();
  posthog.init(env.VITE_POSTHOG_KEY, {
    bootstrap: {
      distinctID,
    },
    api_host: env.VITE_POSTHOG_HOST,
    disable_external_dependency_loading: true,
    error_tracking: {
      captureExtensionExceptions: true,
    },
    persistence: "localStorage",
  });
};

export const { captureException, identify, initialize } = {
  captureException: (exception) => {
    void (async () => {
      await init();
      posthog.captureException(exception);
    })();
  },
  identify: <T extends { id: string }>(user: T | null) => {
    void (async () => {
      await init();
      if (user) {
        posthog.identify(user.id);
      } else {
        posthog.reset();
      }
    })();
  },
  initialize: () => {
    void (async () => {
      await init();
    })();
  },
} satisfies MonitoringProviderStrategy;
