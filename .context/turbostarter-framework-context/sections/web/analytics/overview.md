---
title: Overview
description: Get started with web analytics in TurboStarter.
url: /docs/web/analytics/overview
---

# Overview

TurboStarter comes with built-in analytics support for multiple providers as well as a unified API for tracking events. This API enables you to easily and consistently track user behavior and app usage across your SaaS application.

## Providers

The starter implements multiple providers for managing analytics. To learn more about each provider and how to configure them, see their respective sections:

<Cards>
  <Card title="Vercel Analytics" href="/docs/web/analytics/configuration#vercel" />

  <Card title="Google Analytics" href="/docs/web/analytics/configuration#google-analytics" />

  <Card title="PostHog" href="/docs/web/analytics/configuration#posthog" />

  <Card title="Mixpanel" href="/docs/web/analytics/configuration#mixpanel" />

  <Card title="Plausible" href="/docs/web/analytics/configuration#plausible" />

  <Card title="Umami" href="/docs/web/analytics/configuration#umami" />

  <Card title="Open Panel" href="/docs/web/analytics/configuration#open-panel" />

  <Card title="Vemetric" href="/docs/web/analytics/configuration#vemetric" />
</Cards>

All configuration and setup is built-in with a unified API, allowing you to switch between providers by simply changing the exports. You can even introduce your own provider without breaking any tracking-related logic.

In the following sections, we'll cover how to set up each provider and how to track events in your application.
