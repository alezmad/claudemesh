---
title: Billing
description: Discover how to manage billing and payment methods for AI features.
url: /ai/docs/billing
---

# Billing

TurboStarter AI includes a straightforward middleware setup to manage user credits for AI features. This lets you control access based on available credits without complex payment integrations.

## Credit-based access

A focused middleware verifies if users have enough credits before allowing them to access specific AI-powered routes or actions.

```ts title="ai.router.ts"
export const aiRouter = new Hono().post(
  "/chat",
  rateLimiter,
  validate("json", chatMessageSchema),
  deductCredits({
    amount: 10, // [!code highlight]
  }),
  streamChat,
);
```

This example shows how the `deductCredits` middleware subtracts a specific amount (10 credits) for each request to the `/chat` endpoint.

## Coming soon

We're actively expanding the billing capabilities for AI services, including:

* **Usage-based billing:** implementing a system where users pay based on their actual consumption of AI resources (tokens used, API calls made, etc.)
* **Payment provider integration:** connecting with popular services like [Stripe](/docs/web/billing/stripe), [Lemon Squeezy](/docs/web/billing/lemon-squeezy), and more for hassle-free payment processing

## Extending billing

For more advanced billing scenarios or immediate needs, you can tap into the core TurboStarter billing features. The main documentation provides detailed guidance on setting up and managing billing with third-party providers.

<Card href="/docs/web/billing/overview" title="Billing documentation" description="Learn more about the comprehensive billing features in TurboStarter." />

Stay tuned for updates as we enhance the AI-specific billing functionalities!
