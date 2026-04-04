---
title: Overview
description: Get started with billing in TurboStarter.
url: /docs/web/billing/overview
---

# Overview

The `@turbostarter/billing` package is used to manage subscriptions, one-off payments, and more.

Inside, we're making an abstraction layer that allows us to use different billing providers without breaking our code nor changing the API calls.

![Billing Providers](/images/docs/billing-providers.webp)

## Providers

TurboStarter implements multiple providers for managing billing:

* [Stripe](/docs/web/billing/stripe)
* [Lemon Squeezy](/docs/web/billing/lemon-squeezy)
* [Polar](/docs/web/billing/polar)
* [Creem](/docs/web/billing/creem) (coming soon)

All configuration and setup is built-in with a unified API, so you can switch between providers by simply changing the exports and even introduce your own provider without breaking any billing-related logic.

## Subscriptions vs. One-off payments

TurboStarter supports both one-off payments and subscriptions. You have the choice to use one or both. What TurboStarter cannot assume with certainty is the billing mode you want to use. By default, we assume you want to use subscriptions, as this is the most common billing mode for SaaS applications.

This means that - by default - TurboStarter will be looking for a subscription plan when visiting the billing section or pricing page.

**It's easily customizable** - [take a look at configuration](/docs/web/billing/configuration).

### But I want to use both

Perfect - you can, but you need to customize the pages to display the correct data.

Depending on the service you use, you will need to set the environment variables accordingly. By default - the billing package uses [Stripe](/docs/web/billing/stripe). Alternatively, you can use [Lemon Squeezy](/docs/web/billing/lemon-squeezy) or [Polar](/docs/web/billing/polar). In the future, we will also add [Creem](/docs/web/billing/creem).
