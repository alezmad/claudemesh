import { PostHog } from "posthog-node";

import { env } from "./env";

import type { AnalyticsProviderServerStrategy } from "@turbostarter/analytics";

const isValidPosthogConfig =
  env.NEXT_PUBLIC_POSTHOG_KEY &&
  env.NEXT_PUBLIC_POSTHOG_KEY !== "notyet" &&
  env.NEXT_PUBLIC_POSTHOG_HOST.startsWith("http");

let client: PostHog | null = null;

const getClient = () => {
  if (!isValidPosthogConfig) {
    return null;
  }

  if (client) {
    return client;
  }

  client = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST,
  });

  return client;
};

export const { track } = {
  track: (event, data) => {
    const client = getClient();
    if (!client) return;

    client.capture({
      event,
      distinctId: typeof data?.distinctId === "string" ? data.distinctId : "",
      properties: data,
    });
  },
} satisfies AnalyticsProviderServerStrategy;
