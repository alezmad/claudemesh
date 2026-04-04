---
title: Overview
description: Get started with web monitoring in TurboStarter.
url: /docs/web/monitoring/overview
---

# Overview

TurboStarter includes lightweight monitoring hooks so you can quickly answer: **what's failing**, **where it's failing**, and **who it's affecting**. Out of the box, the web app can report exceptions from both the client and the server, and it's designed to be easy to extend with your preferred provider.

## Capturing exceptions

Monitoring starts with capturing exceptions reliably in the places that matter most:

* **Client-side errors**: the Next.js App Router error boundary reports unexpected runtime errors so you get visibility without leaving users stuck on a broken screen.
* **Server-side errors**: API failures (for example, Hono errors in production) can be reported with a stable, anonymous distinct id so you can spot recurring issues and correlate them with sessions.
* **Manual reporting**: you can also report exceptions from your own `try/catch` blocks to add extra context around critical flows (payments, onboarding, imports, etc.).

<Tabs items={["Client-side", "Server-side"]}>
  <Tab value="Client-side">
    ```tsx
    "use client";

    import { captureException } from "@turbostarter/monitoring-web";

    export default function ExampleComponent() {
      const handleClick = () => {
        try {
          /* some risky operation */
        } catch (error) {
          captureException(error);
        }
      };

      return <button onClick={handleClick}>Trigger Exception</button>;
    }
    ```
  </Tab>

  <Tab value="Server-side">
    ```ts
    import { captureException } from "@turbostarter/monitoring-web/server";

    try {
      /* do something */
    } catch (error) {
      captureException(error);
    }
    ```
  </Tab>
</Tabs>

<Callout type="error" title="Ensure correct import!">
  Make sure to use the correct import for the `captureException` function. We're using the same name for both client and server monitoring, but they are different functions. For server-side, just add `/server` to the import path (`@turbostarter/monitoring-web/server`).

  <Tabs items={["Client-side", "Server-side"]}>
    <Tab value="Client-side">
      ```tsx
      import { captureException } from "@turbostarter/monitoring-web";
      ```
    </Tab>

    <Tab value="Server-side">
      ```tsx
      // [!code word:server]
      import { captureException } from "@turbostarter/monitoring-web/server";
      ```
    </Tab>
  </Tabs>
</Callout>

## Identifying users

Exception reports become dramatically more actionable once they're tied to a real user. TurboStarter automatically identifies signed-in users (based on the current auth session), which allows your monitoring provider to associate exceptions and sessions with a user profile.

If you want richer debugging, identify users with traits (like email, plan, or role) so you can filter and segment issues by the people impacted.

```tsx title="monitoring.tsx"
"use client";

import { useEffect } from "react";
import { identify } from "@turbostarter/monitoring-web";
import { authClient } from "~/lib/auth/client";

export const MonitoringProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const session = authClient.useSession();

  useEffect(() => {
    if (session.isPending) {
      return;
    }

    identify(session.data?.user ?? null);
  }, [session]);

  return <>{children}</>;
};
```

<Callout title="Identifying users on the server" type="warn">
  On the server, there are no dedicated identification helper. Most providers that support user-level tracking expect you to pass an identifier or traits directly within the `captureException` call (for example, as a `userId` or similar property), so make sure to check your specific provider's documentation for the recommended way to include user information.
</Callout>

## Providers

The starter implements multiple providers for managing monitoring. To learn more about each provider and how to configure them, see their respective sections:

<Cards>
  <Card title="Sentry" href="/docs/web/monitoring/sentry" />

  <Card title="PostHog" href="/docs/web/monitoring/posthog" />
</Cards>

Configuration and setup are handled for you via a unified API, making it easy to switch monitoring providers by just updating the exports. You can also add custom providers without disrupting any monitoring-related logic.

## Best practices

Below are some guidelines to keep monitoring useful, low-noise, and privacy-safe.

<Cards>
  <Card title="Capture actionable errors" className="shadow-none">
    Report unexpected exceptions and failed business-critical operations; avoid
    logging “expected” states (validation errors, user cancellations, missing
    optional data).
  </Card>

  <Card title="Add context" className="shadow-none">
    Include what the user was doing (route/action), relevant IDs (request id,
    order id), and a clear message so you can reproduce and triage quickly.
  </Card>

  <Card title="Identify users, but avoid PII" className="shadow-none">
    Identify with stable IDs; only attach traits that are necessary for
    debugging. Don’t send secrets or sensitive fields (tokens, passwords, raw
    payment details).
  </Card>

  <Card title="Deduplicate and rate-limit" className="shadow-none">
    If a loop or retry can fire many times, guard your capture calls so you
    don’t spam your provider (and your budget).
  </Card>

  <Card title="Separate environments" className="shadow-none">
    Keep dev/staging/prod isolated (separate projects or environment tags) so
    production alerts stay meaningful.
  </Card>

  <Card title="Alert on symptoms that matter" className="shadow-none">
    Set alerts for spikes in error rate, degraded performance, and failures in
    critical flows (auth, checkout, billing webhooks), not for every single
    exception.
  </Card>
</Cards>

Application monitoring helps you track errors, exceptions, and performance issues for better app reliability. With multiple provider support, you can quickly spot and resolve problems.

Focus on actionable errors, useful context, and user privacy to get the most value from your monitoring.
