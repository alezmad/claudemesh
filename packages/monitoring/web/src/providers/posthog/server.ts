import { PostHog } from "posthog-node";

import { env } from "./env";

import type { MonitoringProviderServerStrategy } from "../types";

const isValidPosthogConfig =
  env.NEXT_PUBLIC_POSTHOG_KEY &&
  env.NEXT_PUBLIC_POSTHOG_KEY !== "notyet" &&
  env.NEXT_PUBLIC_POSTHOG_HOST.startsWith("http");

let posthogInstance: PostHog | null = null;

export function getPostHogServer() {
  if (!isValidPosthogConfig) {
    return null;
  }

  const key = env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;

  posthogInstance ??= new PostHog(key, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });

  return posthogInstance;
}

export const { captureException, initialize, onRequestError } = {
  captureException: (exception, extra = undefined) => {
    const posthog = getPostHogServer();
    if (!posthog) return;

    const distinctId = typeof extra?.id === "string" ? extra.id : undefined;
    posthog.captureException(exception, distinctId, extra);
  },
  initialize: () => {
    getPostHogServer();
  },
  onRequestError: (error, request) => {
    /* eslint-disable-next-line turbo/no-undeclared-env-vars, no-restricted-properties */
    if (process.env.NEXT_RUNTIME !== "nodejs") {
      return;
    }

    const posthog = getPostHogServer();
    if (!posthog) return;
    let distinctId: string | undefined;
    if (request.headers.cookie) {
      const cookieString = Array.isArray(request.headers.cookie)
        ? request.headers.cookie.join("; ")
        : request.headers.cookie;

      const postHogCookieMatch = /ph_phc_.*?_posthog=([^;]+)/.exec(
        cookieString,
      );

      if (postHogCookieMatch?.[1]) {
        try {
          const decodedCookie = decodeURIComponent(postHogCookieMatch[1]);
          const data: unknown = JSON.parse(decodedCookie);

          if (
            typeof data === "object" &&
            data !== null &&
            "distinct_id" in data &&
            typeof data.distinct_id === "string"
          ) {
            distinctId = data.distinct_id;
          }
        } catch {
          /*  Ignore */
        }
      }
    }

    posthog.captureException(error, distinctId);
  },
} satisfies MonitoringProviderServerStrategy;
