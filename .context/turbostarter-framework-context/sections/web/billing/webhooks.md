---
title: Webhooks
description: Handle webhooks from your billing provider.
url: /docs/web/billing/webhooks
---

# Webhooks

TurboStarter handles billing webhooks to update customer data based on events received from the billing provider.

Occasionally, you may need to set up additional webhooks or perform custom actions with webhooks.

In such cases, you can customize the billing webhook handler in the billing router at `packages/api/src/modules/billing/router.ts`.

By default, the webhook handler is configured to be as straightforward as possible:

```ts title="router.ts"
import { webhookHandler } from "@turbostarter/billing/server";

export const billingRouter = new Hono().post("/webhook", (c) =>
  webhookHandler(c.req.raw),
);
```

However, you can extend it using the callbacks provided from `@turbostarter/billing` package:

```ts title="router.ts"
import { webhookHandler } from "@turbostarter/billing/server";

export const billingRouter = new Hono().post("/webhook", (c) =>
  webhookHandler(c.req.raw, {
    onCheckoutSessionCompleted: (sessionId) => {},
    onSubscriptionCreated: (subscriptionId) => {},
    onSubscriptionUpdated: (subscriptionId) => {},
    onSubscriptionDeleted: (subscriptionId) => {},
    onEvent: (rawEvent) => {},
  }),
);
```

You can provide one or more of the callbacks to handle the events you are interested in.
