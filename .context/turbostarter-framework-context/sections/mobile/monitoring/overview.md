---
title: Overview
description: Get started with mobile monitoring in TurboStarter.
url: /docs/mobile/monitoring/overview
---

# Overview

TurboStarter ships with powerful, provider-agnostic monitoring helpers for the mobile app so you can answer the questions that matter in production: **what broke**, **on which screen**, and **which users were impacted**. It's designed for simplicity and extensibility, and works with multiple providers behind a single API.

## Capturing exceptions

On mobile, you'll usually want to report errors from a few key places:

* **UI/runtime crashes**: unexpected JS errors that would otherwise blank the screen or break navigation.
* **Async work**: background tasks, effects, and data fetching where failures are easy to miss.
* **Manual reporting**: wrap critical flows (auth, purchases, sync, deep-links) with `try/catch` so you can attach context when things go wrong.

```tsx
import { Pressable, Text } from "react-native";
import { captureException } from "@turbostarter/monitoring-mobile";

export default function ExampleComponent() {
  const handleClick = () => {
    try {
      /* some risky operation */
    } catch (error) {
      captureException(error);
    }
  };

  return (
    <Pressable onPress={handleClick}>
      <Text>Trigger Exception</Text>
    </Pressable>
  );
}
```

<Callout type="warn" title="JS exceptions vs native crashes">
  `try/catch` (and most JS error handlers) can only see JavaScript exceptions. Native crashes (for example, a hard crash in a native module) typically require provider-specific native setup to capture crash reports. Use the provider pages below for platform details.
</Callout>

## Identifying users

Error reports become much more actionable once they're tied to a signed-in user. TurboStarter supports identifying the current user after the auth session resolves, so your monitoring provider can associate errors with a stable user profile (without you plumbing this through every capture call).

If you want richer filtering, pass non-sensitive traits (plan, role, locale) depending on what your provider supports.

```tsx title="monitoring.tsx"
import { useEffect } from "react";
import { identify } from "@turbostarter/monitoring-mobile";
import { authClient } from "~/lib/auth";

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

  return children;
};
```

<Callout title="Keep user data minimal" type="error">
  Identify users with **stable IDs** and only the traits you need for debugging. Avoid sending PII or secrets (tokens, raw emails, payment details) unless you've explicitly decided it's acceptable for your monitoring provider and compliance requirements.
</Callout>

## Providers

TurboStarter can report through different monitoring providers while keeping your app code consistent. Choose a provider (or swap later) by updating the exports/config in the monitoring package.

<Cards>
  <Card title="Sentry" href="/docs/mobile/monitoring/sentry" />

  <Card title="PostHog" href="/docs/mobile/monitoring/posthog" />
</Cards>

## Recommended practices

<Cards>
  <Card title="Report what you'd actually act on" className="shadow-none">
    Prioritize crashes, failed network calls that break a flow, and unexpected
    states. Skip noisy “expected” errors (validation, user cancellations).
  </Card>

  <Card title="Attach useful context" className="shadow-none">
    Include the screen/route, the action the user took, and relevant IDs
    (request id, order id). Mobile issues are often device- or version-specific,
    so make sure app version/build info is included by your provider.
  </Card>

  <Card title="Guard against loops" className="shadow-none">
    If an effect or retry path can fire repeatedly, debounce or dedupe your
    capture calls so you don't spam reports (or exceed quotas).
  </Card>

  <Card title="Separate dev/staging/prod" className="shadow-none">
    Keep environments isolated so test devices don't pollute production signal.
    Tag builds/releases so you can correlate spikes with deployments.
  </Card>
</Cards>

With solid capture + identification in place, mobile monitoring becomes a feedback loop: you can spot regressions quickly, understand who they affect, and validate fixes by release.
