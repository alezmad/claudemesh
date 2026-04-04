import posthog from "posthog-js";

import { env } from "./env";

import type { MonitoringProviderClientStrategy } from "../types";

const isValidPosthogConfig =
  env.NEXT_PUBLIC_POSTHOG_KEY &&
  env.NEXT_PUBLIC_POSTHOG_KEY !== "notyet" &&
  env.NEXT_PUBLIC_POSTHOG_HOST.startsWith("http");

let initialized = false;

export const {
  captureException,
  identify,
  initialize,
  onRouterTransitionStart,
} = {
  captureException: (exception) => {
    if (!initialized) return;
    posthog.captureException(exception);
  },
  identify: <T extends { id: string }>(user: T | null) => {
    if (!initialized) return;
    if (user) {
      posthog.identify(user.id);
    } else {
      posthog.reset();
    }
  },
  initialize: () => {
    if (!isValidPosthogConfig) return;
    const key = env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    posthog.init(key, {
      api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
    });
    initialized = true;
  },
  onRouterTransitionStart: () => {
    /*  PostHog does not provide a way to capture router transitions yet */
  },
} satisfies MonitoringProviderClientStrategy;
