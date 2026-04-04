---
title: Billing
description: Find answers to common billing issues.
url: /docs/web/troubleshooting/billing
---

# Billing

## Checkout can't be created

This happen in the following cases:

1. The environment variables are not set correctly. Please make sure you have set the environment variables corresponding to your billing provider in `.env.local` if locally - or in your hosting provider's dashboard if in production
2. The price IDs used are incorrect. Make sure to use the exact price IDs as they are in the payment provider's dashboard.

[Read more about billing configuration](/docs/web/billing/configuration)

## Database is not updated after subscribing to a plan

This may happen if the webhook is not set up correctly. Please make sure you have set up the webhook in the payment provider's dashboard and that the URL is correct.

If working locally, make sure that:

1. If using Stripe, that the Stripe CLI or configured proxy is up and running ([see the Stripe documentation for more information](/docs/web/billing/stripe#create-a-webhook))
2. If using Lemon Squeezy, that the webhook set in Lemon Squeezy is correct and that the server is running. Additionally, make sure the proxy is set up correctly if you are testing locally ([see the Lemon Squeezy documentation for more information](/docs/web/billing/lemon-squeezy#create-a-webhook)).
