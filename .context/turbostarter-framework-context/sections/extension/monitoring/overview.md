---
title: Overview
description: Get started with browser extension monitoring in TurboStarter.
url: /docs/extension/monitoring/overview
---

# Overview

TurboStarter includes powerful, provider-agnostic monitoring helpers for the browser extension so you can understand **what failed**, **where it failed** (popup, content script, background), and **who it impacted**. The API is intentionally designed for simplicity and extensibility, so you can swap providers without rewriting your extension code.

## Capturing exceptions

Extensions have multiple runtimes. To get good coverage, capture errors in the places users actually feel them:

* **Popup / options UI**: React pages where runtime errors break interactions.
* **Background (service worker)**: long-lived logic like alarms, message routing, and sync.
* **Content scripts**: page integrations where DOM differences and CSP can trigger failures.
* **Manual reporting**: wrap critical flows (auth, billing, webhooks-to-extension sync, imports) with `try/catch` and report with context.

<Tabs items={["Popup / options", "Background", "Content script"]}>
  <Tab value="Popup / options">
    ```tsx
    import { captureException } from "@turbostarter/monitoring-extension";

    export function ExampleButton() {
      const onPress = async () => {
        try {
          /* some risky operation */
        } catch (error) {
          captureException(error);
        }
      };

      return <button onClick={onPress}>Trigger Exception</button>;
    }
    ```
  </Tab>

  <Tab value="Background">
    ```ts
    import { captureException } from "@turbostarter/monitoring-extension";

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      try {
        /* handle message */
        sendResponse({ ok: true });
      } catch (error) {
        captureException(error);
        sendResponse({ ok: false });
      }
    });
    ```
  </Tab>

  <Tab value="Content script">
    ```ts
    import { captureException } from "@turbostarter/monitoring-extension";

    try {
      /* interact with the page DOM */
    } catch (error) {
      captureException(error);
    }
    ```
  </Tab>
</Tabs>

<Callout type="warn" title="Don't rely on a single runtime">
  An exception in a content script won't automatically show up in your background logs (and vice versa). Add capture points in each runtime you ship, especially if you do message passing between them.
</Callout>

## Identifying users

Monitoring becomes far more useful once reports can be tied to a stable identity. In extensions you often have two “identities”:

* **Anonymous, stable install id**: useful before sign-in (and to correlate issues with a device/install).
* **Signed-in user**: once the user authenticates, identify with their user id so issues map to a real account.

TurboStarter's monitoring layer supports identifying the current user when your auth session resolves. When signed out, pass `null` (or your provider's preferred anonymous identity strategy).

```tsx title="monitoring.tsx"
import { useEffect } from "react";
import { identify } from "@turbostarter/monitoring-extension";
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

<Callout title="Privacy defaults" type="error">
  Prefer **stable IDs** over PII. Only attach traits that help debugging (plan, role, extension version) and avoid secrets (tokens, passwords) or sensitive fields unless you've explicitly chosen to send them.
</Callout>

## Providers

The starter supports multiple monitoring providers behind the same API, so you can start with one and switch later.

<Cards>
  <Card title="Sentry" href="/docs/extension/monitoring/sentry" />

  <Card title="PostHog" href="/docs/extension/monitoring/posthog" />
</Cards>

## Best practices

<Cards>
  <Card title="Include runtime + version context" className="shadow-none">
    Extension issues are often environment-specific. Make sure you can filter by
    runtime (popup/background/content script), extension version, and browser.
  </Card>

  <Card title="Capture actionable failures" className="shadow-none">
    Focus on crashes and failures that break core flows; skip “expected” states
    like validation errors or user cancellations.
  </Card>

  <Card title="Dedupe noisy loops" className="shadow-none">
    Background alarms, retries, and message loops can generate many identical
    errors. Guard your capture calls to keep signal high (and costs low).
  </Card>

  <Card title="Keep environments separate" className="shadow-none">
    Don't mix dev/beta/stable releases. Tag builds so you can correlate spikes
    with a rollout and verify fixes quickly.
  </Card>
</Cards>

With capture points in each runtime, user identification wired up, and a provider configured, extension monitoring becomes a tight feedback loop: you can spot regressions early, understand which surface area is failing and validate fixes confidently as you ship new versions.
