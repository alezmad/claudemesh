---
title: Configuration
description: Learn how to configure web analytics in TurboStarter.
url: /docs/web/analytics/configuration
---

# Configuration

The `@turbostarter/analytics-web` package offers a streamlined and flexible approach to tracking events in your TurboStarter web app using various analytics providers. It abstracts the complexities of different analytics services and provides a consistent interface for event tracking.

In this section, we'll guide you through the configuration process for each supported provider.

Note that the configuration is validated against a schema, so you'll see error messages in the console if anything is misconfigured.

## Providers

TurboStarter supports multiple analytics providers, each with its own unique configuration. Below, you'll find detailed information on how to set up and use each supported provider. Choose the one that best suits your needs and follow the instructions in the respective accordion section.

<Accordions>
  <Accordion title="Vercel Analytics" id="vercel">
    To use Vercel Analytics as your provider, you need to [create a Vercel account](https://vercel.com/) and [set up a project](https://vercel.com/docs/projects/overview).

    Next, enable analytics in your Vercel project settings:

    1. Navigate to the [Vercel dashboard](https://vercel.com/dashboard).
    2. Select your project.
    3. Go to the *Analytics* section.
    4. Click *Enable* in the dialog.

    <Callout>
      Enabling Web Analytics will add new routes (scoped at `/_vercel/insights/*`) after your next deployment.
    </Callout>

    Also, make sure to activate the Vercel provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:vercel]
        export * from "./vercel";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:vercel]
        export * from "./vercel/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:vercel]
        export * from "./vercel/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/vercel` directory.

    For more information, please refer to the [Vercel Analytics documentation](https://vercel.com/docs/analytics/overview).

    ![Vercel Analytics dashboard](/images/docs/web/analytics/vercel.avif)
  </Accordion>

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

    Set these values in your `.env.local` file in the `apps/web` directory and in your deployment environment:

    ```dotenv
    NEXT_PUBLIC_ANALYTICS_GOOGLE_MEASUREMENT_ID="your-measurement-id"
    GOOGLE_ANALYTICS_SECRET="your-measurement-protocol-api-secret"
    ```

    Also, make sure to activate the Google Analytics provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:google-analytics]
        export * from "./google-analytics";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:google-analytics]
        export * from "./google-analytics/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:google-analytics]
        export * from "./google-analytics/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/google-analytics` directory.

    For more information, please refer to the [Google Analytics documentation](https://developers.google.com/analytics).

    ![Google Analytics dashboard](/images/docs/web/analytics/google/dashboard.jpg)
  </Accordion>

  <Accordion title="PostHog" id="posthog">
    <Callout title="You can also use it for monitoring!">
      PostHog is also one of pre-configured providers for [monitoring](/docs/web/monitoring/overview) in TurboStarter. You can learn more about it [here](/docs/web/monitoring/posthog).
    </Callout>

    To use PostHog as your analytics provider, you need to configure a PostHog instance. You can obtain the [Cloud](https://app.posthog.com/signup) instance by [creating an account](https://app.posthog.com/signup) or [self-host](https://posthog.com/docs/self-host) it.

    Then, create a project and, based on your [project settings](https://app.posthog.com/project/settings), fill the following environment variables in your `.env.local` file in `apps/web` directory and your deployment environment:

    ```dotenv
    NEXT_PUBLIC_POSTHOG_KEY="your-posthog-api-key"
    NEXT_PUBLIC_POSTHOG_HOST="your-posthog-instance-host"
    ```

    Also, make sure to activate the PostHog provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:posthog]
        export * from "./posthog";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:posthog]
        export * from "./posthog/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:posthog]
        export * from "./posthog/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/posthog` directory.

    For more information, please refer to the [PostHog documentation](https://posthog.com/docs).

    ![PostHog dashboard](/images/docs/web/analytics/posthog.png)
  </Accordion>

  <Accordion title="Mixpanel" id="mixpanel">
    To use Mixpanel as your analytics provider, you need to [create an account](https://mixpanel.com/) and [obtain your project token](https://help.mixpanel.com/hc/en-us/articles/115004502806-Find-Project-Token).

    Then, set it as an environment variable in your `.env.local` file in the `apps/web` directory and your deployment environment:

    ```dotenv
    NEXT_PUBLIC_MIXPANEL_TOKEN="your-project-token"
    ```

    Also, make sure to activate the Mixpanel provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:mixpanel]
        export * from "./mixpanel";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:mixpanel]
        export * from "./mixpanel/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:mixpanel]
        export * from "./mixpanel/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/mixpanel` directory.

    For more information, please refer to the [Mixpanel documentation](https://docs.mixpanel.com/).

    ![Mixpanel dashboard](/images/docs/web/analytics/mixpanel.png)
  </Accordion>

  <Accordion title="Plausible" id="plausible">
    To use Plausible as your analytics provider, you need to [create an account](https://plausible.io/) and [set up a website](https://plausible.io/docs/add-website).

    Then, set your domain and host in your `.env.local` file in the `apps/web` directory and your deployment environment:

    ```dotenv
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN="your-website-domain.com"
    NEXT_PUBLIC_PLAUSIBLE_HOST="https://plausible.io"
    ```

    Also, make sure to activate the Plausible provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:plausible]
        export * from "./plausible";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:plausible]
        export * from "./plausible/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:plausible]
        export * from "./plausible/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/plausible` directory.

    For more information, please refer to the [Plausible documentation](https://plausible.io/docs).

    ![Plausible dashboard](/images/docs/web/analytics/plausible.png)
  </Accordion>

  <Accordion title="Umami" id="umami">
    To use Umami as your analytics provider, you need to [set up Umami](https://umami.is/docs/getting-started) either by using their [cloud service](https://cloud.umami.is/) or [self-hosting](https://umami.is/docs/install).

    Then, set your website ID and host in your `.env.local` file in the `apps/web` directory and your deployment environment:

    ```dotenv
    NEXT_PUBLIC_UMAMI_WEBSITE_ID="your-website-id"
    NEXT_PUBLIC_UMAMI_HOST="https://your-umami-instance.com"
    UMAMI_API_HOST="https://your-umami-instance.com"
    UMAMI_API_KEY="your-api-key"
    ```

    Also, make sure to activate the Umami provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:umami]
        export * from "./umami";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:umami]
        export * from "./umami/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:umami]
        export * from "./umami/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/umami` directory.

    For more information, please refer to the [Umami documentation](https://umami.is/docs).

    ![Umami dashboard](/images/docs/web/analytics/umami.jpg)
  </Accordion>

  <Accordion title="Open Panel" id="open-panel">
    To use Open Panel as your analytics provider, you need to [create an account](https://openpanel.dev/) and [set up a client for your project](https://docs.openpanel.dev/docs).

    Then, you would need to set your client ID and secret in your `.env.local` file in `apps/web` directory and your deployment environment:

    ```dotenv
    NEXT_PUBLIC_OPEN_PANEL_CLIENT_ID="your-client-id"
    OPEN_PANEL_CLIENT_SECRET="your-client-secret"
    ```

    Also, make sure to activate the Open Panel provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:open-panel]
        export * from "./open-panel";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:open-panel]
        export * from "./open-panel/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:open-panel]
        export * from "./open-panel/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/open-panel` directory.

    For more information, please refer to the [Open Panel documentation](https://docs.openpanel.dev/).

    ![Open Panel dashboard](/images/docs/web/analytics/open-panel.webp)
  </Accordion>

  <Accordion title="Vemetric" id="vemetric">
    To use Vemetric as your analytics provider, you need to [create an account](https://vemetric.com/) and [obtain your project token](https://vemetric.com/docs/).

    Then, set it as an environment variable in your `.env.local` file in the `apps/web` directory and your deployment environment:

    ```dotenv
    NEXT_PUBLIC_VEMETRIC_PROJECT_TOKEN="your-project-token"
    ```

    Also, make sure to activate the Vemetric provider as your analytics provider by updating the exports in:

    <Tabs items={["index.tsx", "server.ts", "env.ts"]}>
      <Tab value="index.tsx">
        ```ts
        // [!code word:vemetric]
        export * from "./vemetric";
        ```
      </Tab>

      <Tab value="server.ts">
        ```ts
        // [!code word:vemetric]
        export * from "./vemetric/server";
        ```
      </Tab>

      <Tab value="env.ts">
        ```ts
        // [!code word:vemetric]
        export * from "./vemetric/env";
        ```
      </Tab>
    </Tabs>

    To customize the provider, you can find its definition in `packages/analytics/web/src/providers/vemetric` directory.

    For more information, please refer to the [Vemetric documentation](https://vemetric.com/docs/).

    ![Vemetric dashboard](/images/docs/web/analytics/vemetric.webp)
  </Accordion>
</Accordions>

## Client-side context

To enable tracking events, capturing page views and other analytics features **on the client-side**, you need to wrap your app with the `Provider` component that's implemented by every provider and available through the `@turbostarter/analytics-web` package:

```tsx title="providers.tsx"
// [!code word:AnalyticsProvider]
import { memo } from "react";

import { Provider as AnalyticsProvider } from "@turbostarter/analytics-web";

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

By implementing this setup, you ensure that all analytics events are properly tracked from your client-side code. This configuration allows you to safely utilize the [Analytics API](/docs/web/analytics/tracking) within your client components, enabling comprehensive event tracking and data collection.
