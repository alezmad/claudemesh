---
title: Overview
description: Get started with mobile analytics in TurboStarter.
url: /docs/mobile/analytics/overview
---

# Overview

When it comes to mobile app analytics, we can distinguish between two types:

* **Store listing analytics**: Used to track the performance of your mobile app's store listing (e.g., how many people have viewed your app in the store or how many have installed it).
* **In-app analytics**: Tracks user actions within your mobile app (e.g., how many users entered a specific screen, how many users clicked on a specific button, etc.).

The `@turbostarter/analytics-mobile` package provides a set of tools to easily implement both types of analytics in your mobile app.

## Store listing analytics

Interpreting your mobile app's store listing metrics can help you evaluate how changes to your app and store listing affect conversion rates. For example, you can identify keywords that users are searching for to optimize your app's store listing.

While each store implements a different set of metrics, there are some common ones you should be aware of:

* **Downloads**: The total number of times your app was downloaded, including both first-time downloads and re-downloads.
* **Sales**: The total number of pre-orders, first-time app downloads, in-app purchases, and their associated sales.
* **Usage**: A variety of user engagement metrics, such as installations, sessions, crashes, and active devices.

To learn more about these or other metrics (e.g., how to create custom reports or KPIs), please refer to the official documentation of the store you're publishing to:

<Cards>
  <Card title="Overview of reporting tools" description="developer.apple.com" href="https://developer.apple.com/help/app-store-connect/measure-app-performance/overview-of-reporting-tools" />

  <Card title="View app statistics" description="support.google.com" href="https://support.google.com/googleplay/android-developer/answer/139628?hl=en&co=GENIE.Platform%3DDesktop&oco=1" />
</Cards>

## In-app analytics

TurboStarter comes with built-in analytics support for multiple providers as well as a unified API for tracking events. This API enables you to easily and consistently track user behavior and app usage across your mobile application.

To learn more about each provider and how to configure them, see their respective sections:

<Cards>
  <Card title="Google Analytics" href="/docs/mobile/analytics/configuration#google-analytics" />

  <Card title="PostHog" href="/docs/mobile/analytics/configuration#posthog" />

  <Card title="Mixpanel" href="/docs/mobile/analytics/configuration#mixpanel" />
</Cards>

All configuration and setup is built-in with a unified API, allowing you to switch between providers by simply changing the exports. You can even introduce your own provider without breaking any tracking-related logic.

In the following sections, we'll cover how to set up each provider and how to track events in your application.
