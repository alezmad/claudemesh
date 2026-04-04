"use client";

import dynamic from "next/dynamic";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { Suspense } from "react";

import { env } from "./env";

import type { AnalyticsProviderClientStrategy } from "@turbostarter/analytics";

const PageView = dynamic(
  () => import("./page-view").then((mod) => mod.PageView),
  {
    ssr: false,
  },
);

const isValidPosthogConfig =
  env.NEXT_PUBLIC_POSTHOG_KEY &&
  env.NEXT_PUBLIC_POSTHOG_KEY !== "notyet" &&
  env.NEXT_PUBLIC_POSTHOG_HOST.startsWith("http");

if (typeof window !== "undefined" && isValidPosthogConfig) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
    person_profiles: "always",
    capture_pageview: false,
    disable_external_dependency_loading: true,
    disable_session_recording: true,
  });
}

export const { Provider, track, identify, reset } = {
  Provider: ({ children }) => {
    // Skip PostHog wrapper entirely when not configured
    if (!isValidPosthogConfig) {
      return <>{children}</>;
    }

    return (
      <PostHogProvider client={posthog}>
        {children}
        <Suspense fallback={null}>
          <PageView />
        </Suspense>
      </PostHogProvider>
    );
  },
  track: (event, properties) => {
    if (typeof window === "undefined") {
      return;
    }

    posthog.capture(event, properties);
  },
  identify: (userId, traits) => {
    if (typeof window === "undefined") {
      return;
    }

    posthog.identify(userId, traits);
  },
  reset: () => {
    if (typeof window === "undefined") {
      return;
    }

    posthog.reset();
  },
} satisfies AnalyticsProviderClientStrategy;
