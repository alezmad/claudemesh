---
title: Overview
description: Get started with extension analytics in TurboStarter.
url: /docs/extension/analytics/overview
---

# Overview

When it comes to extension analytics, we can distinguish between two types:

* **Store listing analytics**: Used to track the performance of your extension's store listing (e.g., how many people have viewed your extension in the store or how many have installed it).
* **In-extension analytics**: Tracks user actions within your extension (e.g., how many users triggered your popup, how many users modified extension settings, etc.).

The `@turbostarter/analytics-extension` package provides a set of tools to easily implement both types of analytics in your extension.

## Store listing analytics

Interpreting your extension's store listing metrics can help you evaluate how changes to your extension and store listing affect conversion rates. For example, you can identify countries with a high number of visitors to prioritize supporting languages for those regions.

While each store implements a different set of metrics, there are some common ones you should be aware of:

* **Active installs**: The number of users who have installed your extension.
* **Active users**: The number of users who have used your extension.
* **Page views**: The number of times users have viewed your extension's detail page on the respective store.

To track more detailed metrics, you can opt in to Google Analytics in the Chrome Web Store's developer dashboard.

You can find this option under *Additional metrics* on the *Store listing* tab of your extension's control panel:

![Chrome Web Store - Store listing - Additional metrics](/images/docs/extension/analytics/opt-in-analytics.png)

<Callout>
  The Chrome Web Store manages the account for you and makes the data available
  in the Google Analytics dashboard.
</Callout>

By enabling this feature, you can optimize your extension's store listing based on metrics such as bounce rate, time on page, and more. This can lead to more installs and ultimately more users for your extension.

To learn more about the limitations of this type of analytics and how to adjust event details, please refer to the following sections in the official documentation:

<Cards>
  <Card title="Analyze your store listing metrics" description="developer.chrome.com" href="https://developer.chrome.com/docs/webstore/metrics" />

  <Card title="Use your Google Analytics account with the Chrome Web Store" description="developer.chrome.com" href="https://developer.chrome.com/docs/webstore/google-analytics" />
</Cards>

## In-extension analytics

TurboStarter comes with built-in support for tracking in-extension analytics. To learn more about each supported provider and how to configure them, see their respective sections:

<Cards>
  <Card title="Google Analytics" href="/docs/extension/analytics/configuration#google-analytics" />

  <Card title="PostHog" href="/docs/extension/analytics/configuration#posthog" />
</Cards>

All configuration and setup is built-in with a unified API, allowing you to switch between providers by simply changing the exports. You can even introduce your own provider without breaking any tracking-related logic.

In the following sections, we'll cover how to set up each provider and how to track events in your extension.
