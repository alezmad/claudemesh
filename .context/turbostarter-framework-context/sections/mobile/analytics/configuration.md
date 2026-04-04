---
title: Configuration
description: Learn how to configure mobile analytics in TurboStarter.
url: /docs/mobile/analytics/configuration
---

# Configuration

The `@turbostarter/analytics-mobile` package offers a streamlined and flexible approach to tracking events in your TurboStarter mobile app using various analytics providers. It abstracts the complexities of different analytics services and provides a consistent interface for event tracking.

In this section, we'll guide you through the configuration process for each supported provider.

Note that the configuration is validated against a schema, so you'll see error messages in the console if anything is misconfigured.

## Permissions

First and foremost, to start tracking any metrics from your app (and to do so legally), you need to ask your users for permission. It's [required](https://support.apple.com/en-us/102420), and you're not allowed to collect any data without it.

To make this process as simple as possible, TurboStarter comes with a `useTrackingPermissions` hook that you can use to access the user's consent status. It will handle asking for permission automatically as well as process updates made through the general phone settings.

```tsx
import { useTrackingPermissions } from "@turbostarter/analytics-mobile";

export const MyComponent = () => {
  const granted = useTrackingPermissions();

  if (granted) {
    // Start tracking
  } else {
    // Disable tracking
  }
};
```

Also, for Apple, you must declare the tracking justification via [App Tracking Transparency](https://developer.apple.com/documentation/apptrackingtransparency). It comes pre-configured in TurboStarter via the [Expo Config Plugin](https://docs.expo.dev/versions/latest/config/app/#plugins), where you can provide a custom message to the user:

```ts title="app.config.ts"
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  plugins: [
    [
      "expo-tracking-transparency",
      {
        /* 🍎 Describe why you need access to the user's data */
        userTrackingPermission:
          "This identifier will be used to deliver personalized ads to you.",
      },
    ],
  ],
});
```

This way, we ensure that the user is aware of the data we collect and can make an informed decision. If you don't provide this information, your app is likely to be rejected by Apple and/or Google during the [review process](/docs/mobile/publishing/checklist#send-to-review).

## Providers

TurboStarter supports multiple analytics providers, each with its own unique configuration. Below, you'll find detailed information on how to set up and use each supported provider. Choose the one that best suits your needs and follow the instructions in the respective accordion section.

<Accordions>
  <Accordion title="Google Analytics" id="google-analytics">
    To use Google Analytics as your analytics provider, you need to [configure and link a Firebase project to your app](/docs/mobile/installation/firebase).

    After that, you can proceed with the installation of the analytics package:

    ```bash
    pnpm add --filter @turbostarter/analytics-mobile @react-native-firebase/analytics
    ```

    Also, make sure to activate the Google Analytics provider as your analytics provider by updating the exports in:

    ```ts title="index.ts"
    // [!code word:google-analytics]
    export * from "./google-analytics";
    export * from "./google-analytics/env";
    ```

    To customize the provider, you can find its definition in `packages/analytics/mobile/src/providers/google-analytics` directory.

    For more information, please refer to the [React Native Firebase documentation](https://rnfirebase.io/analytics/usage).

    ![Google Analytics dashboard](/images/docs/web/analytics/google/dashboard.jpg)
  </Accordion>

  <Accordion title="PostHog" id="posthog">
    <Callout type="info" title="You can also use it for monitoring!">
      PostHog is also one of pre-configured providers for [monitoring](/docs/mobile/monitoring/overview) in TurboStarter mobile apps. You can learn more about it [here](/docs/mobile/monitoring/posthog).
    </Callout>

    To use PostHog as your analytics provider, you need to configure a PostHog instance. You can obtain the [Cloud](https://app.posthog.com/signup) instance by [creating an account](https://app.posthog.com/signup) or [self-host](https://posthog.com/docs/self-host) it.

    Then, create a project and, based on your [project settings](https://app.posthog.com/project/settings), fill the following environment variables in your `.env.local` file in `apps/mobile` directory and your `eas.json` file:

    ```dotenv
    EXPO_PUBLIC_POSTHOG_KEY="your-posthog-api-key"
    EXPO_PUBLIC_POSTHOG_HOST="your-posthog-instance-host"
    ```

    Also, make sure to activate the PostHog provider as your analytics provider by updating the exports in:

    ```ts title="index.ts"
    // [!code word:posthog]
    export * from "./posthog";
    export * from "./posthog/env";
    ```

    To customize the provider, you can find its definition in `packages/analytics/mobile/src/providers/posthog` directory.

    For more information, please refer to the [PostHog documentation](https://posthog.com/docs).

    ![PostHog dashboard](/images/docs/web/analytics/posthog.png)
  </Accordion>

  <Accordion title="Mixpanel" id="mixpanel">
    To use Mixpanel as your analytics provider, you need to [create an account](https://mixpanel.com/) and [obtain your project token](https://help.mixpanel.com/hc/en-us/articles/115004502806-Find-Project-Token).

    Then, set it as an environment variable in your `.env.local` file in the `apps/mobile` directory and your `eas.json` file:

    ```dotenv
    EXPO_PUBLIC_MIXPANEL_TOKEN="your-project-token"
    ```

    Also, make sure to activate the Mixpanel provider as your analytics provider by updating the exports in:

    ```ts title="index.ts"
    // [!code word:mixpanel]
    export * from "./mixpanel";
    export * from "./mixpanel/env";
    ```

    To customize the provider, you can find its definition in `packages/analytics/mobile/src/providers/mixpanel` directory.

    For more information, please refer to the [Mixpanel documentation](https://docs.mixpanel.com/).
  </Accordion>
</Accordions>

## Context

To enable tracking events, capturing screen views and other analytics features, you need to wrap your app with the `Provider` component that's implemented by every provider and available through the `@turbostarter/analytics-mobile` package:

```tsx title="providers.tsx"
// [!code word:AnalyticsProvider]
import { memo } from "react";

import { Provider as AnalyticsProvider } from "@turbostarter/analytics-mobile";

interface ProvidersProps {
  readonly children: React.ReactNode;
}

export const Providers = memo<ProvidersProps>(({ children }) => {
  return (
    <OtherProviders>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </OtherProviders>
  );
});

Providers.displayName = "Providers";
```

By implementing this setup, you ensure that all analytics events are properly tracked from your mobile app code. This configuration allows you to safely utilize the [Analytics API](/docs/mobile/analytics/tracking) within your components, enabling comprehensive event tracking and data collection.
