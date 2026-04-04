---
title: Configuration
description: Learn how to configure extension analytics in TurboStarter.
url: /docs/extension/analytics/configuration
---

# Configuration

The `@turbostarter/analytics-extension` package offers a streamlined and flexible approach to tracking events in your TurboStarter extension using various analytics providers. It abstracts the complexities of different analytics services and provides a consistent interface for event tracking.

In this section, we'll guide you through the configuration process for each supported provider.

Note that the configuration is validated against a schema, so you'll see error messages in the console if anything is misconfigured.

## Providers

Below, you'll find detailed information on how to set up and use each supported provider. Choose the one that best suits your needs and follow the instructions in the respective accordion section.

<Accordions>
  <Accordion title="Google Analytics" id="google-analytics">
    To use Google Analytics as your analytics provider, you need to [create a Google Analytics account](https://analytics.google.com/) and [set up a property](https://support.google.com/analytics/answer/9304153).

    Next, add a data stream in your Google Analytics account settings:

    1. Navigate to [Google Analytics](https://analytics.google.com/).
    2. In the *Admin* section, under *Data collection and modification*, click on *Data Streams*.
    3. Click *Add stream*.
    4. Select *Web* as the platform.
    5. Enter the required details for the stream (at minimum, provide a name and website URL).
    6. Click *Create stream*.

    After creating the stream, you'll need two pieces of information:

    1. Your [Measurement ID](https://support.google.com/analytics/answer/12270356) (it should look like `G-XXXXXXXXXX`):

    ![Google Analytics Measurement ID](/images/docs/web/analytics/google/id.png)

    2. Your [Measurement Protocol API secret](https://support.google.com/analytics/answer/9814495):

    ![Google Analytics Measurement Protocol API secret](/images/docs/web/analytics/google/api-secret.png)

    Set these values in your `.env.local` file in the `apps/extension` directory and in your CI/CD provider secrets:

    ```dotenv
    VITE_GOOGLE_ANALYTICS_MEASUREMENT_ID="your-measurement-id"
    VITE_GOOGLE_ANALYTICS_SECRET="your-measurement-protocol-api-secret"
    ```

    Also, make sure to activate the Google Analytics provider as your analytics provider by updating the exports in:

    ```ts title="index.ts"
    // [!code word:google-analytics]
    export * from "./google-analytics";
    export * from "./google-analytics/env";
    ```

    To customize the provider, you can find its definition in `packages/analytics/extension/src/providers/google-analytics` directory.

    For more information, please refer to the [Google Analytics documentation](https://developers.google.com/analytics).

    ![Google Analytics dashboard](/images/docs/web/analytics/google/dashboard.jpg)
  </Accordion>

  <Accordion title="PostHog" id="posthog">
    <Callout type="info" title="You can also use it for monitoring!">
      PostHog is also one of pre-configured providers for [monitoring](/docs/extension/monitoring/overview) in TurboStarter. You can learn more about it [here](/docs/extension/monitoring/posthog).
    </Callout>

    To use PostHog as your analytics provider, you need to configure a PostHog instance. You can obtain the [Cloud](https://app.posthog.com/signup) instance by [creating an account](https://app.posthog.com/signup) or [self-host](https://posthog.com/docs/self-host) it.

    Then, create a project and, based on your [project settings](https://app.posthog.com/project/settings), fill the following environment variables in your `.env.local` file in `apps/extension` directory and your CI/CD provider secrets:

    ```dotenv
    VITE_POSTHOG_KEY="your-posthog-api-key"
    VITE_POSTHOG_HOST="your-posthog-instance-host"
    ```

    Also, make sure to activate the PostHog provider as your analytics provider by updating the exports in:

    ```ts title="index.ts"
    // [!code word:posthog]
    export * from "./posthog";
    export * from "./posthog/env";
    ```

    To customize the provider, you can find its definition in `packages/analytics/extension/src/providers/posthog` directory.

    For more information, please refer to the [PostHog documentation](https://posthog.com/docs/advanced/browser-extension).

    ![PostHog dashboard](/images/docs/web/analytics/posthog.png)
  </Accordion>
</Accordions>
