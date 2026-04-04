---
title: Security
description: Learn about the security measures implemented in TurboStarter AI.
url: /ai/docs/security
---

# Security

<Callout>
  Remember to regularly review your security implementations and update them as needed.
</Callout>

The starter kit incorporates several security measures to protect your application and users when interacting with AI services.

## Authenticated endpoints

All AI operation endpoints require user authentication. This is enforced through middleware that verifies the user's session before granting access to any AI features.

<Card title="Authentication" href="/ai/docs/auth" description="Learn more about the authentication setup in TurboStarter AI." />

The system creates anonymous sessions by default, but you can implement stronger authentication using the core framework's capabilities or the dedicated [authentication setup](/docs/web/auth/overview).

## Credit-based access

To prevent AI resource abuse, TurboStarter AI includes a credit-based system. Users receive a limited number of credits that are consumed when using AI features.

<Card title="Billing" href="/ai/docs/billing" description="Learn more about the billing and credits system." />

This approach avoids misuse while enabling potential monetization. Learn about the implementation details in the [Core billing documentation](/docs/web/billing/overview).

## Rate limiting

API endpoints are guarded by rate limiting to prevent abuse and ensure fair usage. This protects your application from potential denial-of-service attacks and excessive request volumes.

<Card title="API" href="/ai/docs/api" description="Learn more about the API layer and services in TurboStarter AI." />

We use [`hono-rate-limiter`](https://github.com/rhinobase/hono-rate-limiter), which supports various storage options including [Redis](https://redis.io/), [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/), and [Memcached](https://memcached.org/) for distributed rate limiting.

## Secure API key handling

Sensitive API keys for AI providers ([OpenAI](/ai/docs/openai), [Anthropic](/ai/docs/anthropic), [Google AI](/ai/docs/google), etc.) are managed exclusively on the backend.

They are **NEVER** exposed to client-side code, dramatically reducing the risk of key leakage or unauthorized usage.

## AI service abuse protection

While TurboStarter AI provides application-level safeguards like credit limits and rate limiting, it's essential to implement additional protection directly with your AI providers.

<Callout type="warn" title="Set limits and alerts">
  Always configure spending limits, usage quotas, and monitoring alerts in your
  AI provider dashboards (e.g., [OpenAI](/ai/docs/openai),
  [Anthropic](/ai/docs/anthropic), [Google AI](/ai/docs/google)). These serve as
  critical safety nets against unexpected costs or potential abuse that might
  bypass your application-level controls.
</Callout>

By combining application-level security with provider-level controls, you'll build truly robust and secure AI applications.
