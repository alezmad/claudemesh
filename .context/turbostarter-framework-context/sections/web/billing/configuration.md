---
title: Configuration
description: Configure billing for your application.
url: /docs/web/billing/configuration
---

# Configuration

The billing configuration schema replicates your billing provider's schema, so that:

* we can display the data in the UI (pricing table, billing section, etc.)
* create the correct checkout session
* make some features work correctly - such as feature-based access

It is common to all billing providers and placed in `packages/billing/src/config/index.ts`. Some billing providers have some differences in what you can or cannot do. In these cases, the schema will try to validate and enforce the rules - but it's up to you to make sure the data is correct.

The schema is based on few entities:

* **Plans:** The main product you are selling (e.g., "Pro Plan", "Starter Plan", etc.)
* **Prices:** The pricing plan for the product (e.g., "Monthly", "Yearly", etc.)
* **Discounts:** The discount for the price (e.g., "10% off", "20% off", etc.)

```ts title="index.ts"
type BillingConfig = {
  plans: PlanWithPrices[];
  discounts: Discount[];
};
```

<Callout title="Getting the schema right is important!" type="error">
  Getting the IDs of your plans is **extremely important** - as these are used to:

  * create the correct checkout
  * manage your customers billing data

  Please take it easy while you configure this, do one step at a time, and test it thoroughly.
</Callout>

## Billing provider

To set the billing provider, you need to modify the exports in the `packages/billing/src/providers` directory. It defaults to [Stripe](/docs/web/billing/stripe).

<Tabs items={["index.ts", "env.ts"]}>
  <Tab value="index.ts">
    ```ts
    // [!code word:stripe]
    export * from "./stripe";
    ```
  </Tab>

  <Tab value="env.ts">
    ```ts
    // [!code word:stripe]
    export * from "./stripe/env";
    ```
  </Tab>
</Tabs>

It's important to set it correctly, as this is used to determine the correct API calls and environment variables used during the communication with the billing provider.

## Billing model

To set the billing model, you need to modify the `BILLING_MODEL` environment variable. It defaults to `recurring` as it's the most common model for SaaS apps.

```dotenv
BILLING_MODEL="recurring"
```

This field will be used to display corresponding data in the UI (e.g. in pricing tables) and to create the correct checkout session.

<Callout title="Available billing models">
  For now, TurboStarter supports two billing models:

  * `recurring` - for subscription-based models
  * `one-time` - for one-time payments

  When changing it, make sure to also update corresponding data on the provider side to match it with the correct billing model.
</Callout>

## Plans

Plans are the main products you are selling. They are defined by the following fields:

```ts title="index.ts"
export const config = billingConfigSchema.parse({
  ...
  plans: [
    {
      id: PricingPlanType.PREMIUM,
      name: "Premium",
      description: "Become a power user and gain benefits",
      badge: "Bestseller",
      prices: [],
    },
  ],
  ...
}) satisfies BillingConfig;
```

Let's break down the fields:

* `id`: The unique identifier for the plan (e.g., `free`, `pro`, `enterprise`, etc.). **This is chosen by you, it doesn't need to be the same one as the one in the provider.** It's also used to determine the access level of the plan.
* `name`: The name of the plan
* `description`: The description of the plan
* `badge`: A badge to display on the product (e.g., "Bestseller", "Popular", etc.)

The majority of these fields are going to populate the pricing table in the UI.

### Prices

Prices are the pricing plans for the plan. They are defined by the following fields:

```ts title="index.ts"
export const config = billingConfigSchema.parse({
  ...
  plans: [
    {
      id: PricingPlanType.PREMIUM,
      name: "Premium",
      description: "Become a power user and gain benefits",
      badge: "Bestseller",
      prices: [
        {
          /* 👇 This is the `priceId` from the provider (e.g. Stripe), `variantId` (e.g. Lemon Squeezy) or `productId` (e.g. Polar) */
          id: "price_1PpZAAFQH4McJDTlig6Fxsyy",
          amount: 1900,
          currency: "usd",
          interval: RecurringInterval.MONTH,
          trialDays: 7,
          type: BillingModel.RECURRING,
        },
      ],
    },
  ],
  ...
}) satisfies BillingConfig;
```

Let's break down the fields:

* `id`: The unique identifier for the price. **This must match the price ID in the billing provider**
* `amount`: The amount of the price (displayed values will be divided by 100)
* `currency`: The currency of the price (only currencies from the [current locale](/docs/web/internationalization/overview) will be displayed - defaults to `usd`)

<Callout title="Set the correct currency on your billing provider">
  Make sure to have the same currency set on your third-party billing provider (e.g. as a [store currency](https://docs.lemonsqueezy.com/help/payments/currencies) on Lemon Squeezy)
</Callout>

* `interval`: The interval of the price (e.g., `month`, `year`, etc.)
* `trialDays`: The number of trial days for the price
* `type`: The type of the price (e.g., `recurring`, `one-time`, etc.)

The amount is set for UI purposes. The billing provider will handle the actual billing - therefore, please make sure the amount is correctly set in the billing provider.

<Callout title="Set the correct price ID!" type="error">
  Make sure to set the correct price ID that corresponds to the price in the billing provider. This is very important - as this is used to identify the correct price when creating a checkout session.
</Callout>

### One-off payments

One-off payments are a type of price that is used to create a checkout session for a one-time payment. They are defined by the following fields:

```ts title="index.ts"
export const config = billingConfigSchema.parse({
  ...
  plans: [
    {
      id: PricingPlanType.PREMIUM,
      name: "Premium",
      description: "Become a power user and gain benefits",
      badge: "Bestseller",
      prices: [
        {
          /* 👇 This is the `priceId` from the provider (e.g. Stripe), `variantId` (e.g. Lemon Squeezy) or `productId` (e.g. Polar) */
          id: "price_1PpUagFQH4McJDTlHCzOmyT6",
          amount: 29900,
          currency: "usd",
          type: BillingModel.ONE_TIME,
        },
      ],
    },
  ],
  ...
}) satisfies BillingConfig;
```

Let's break down the fields:

* `id`: The unique identifier for the price. **This must match the price ID in the billing provider**
* `amount`: The amount of the price (displayed values will be divided by 100)
* `currency`: The currency of the price (only currencies from the [current locale](/docs/web/internationalization/overview) will be displayed - defaults to `usd`)
* `type`: The type of the price (e.g. `recurring`, `one-time`, etc.). In this case it's `one-time` as it's a one-off payment.

Please remember that the cost is set for UI purposes. **The billing provider will handle the actual billing - therefore, please make sure the cost is correctly set in the billing provider.**

### Custom prices

Sometimes - you want to display a price in the pricing table - but not actually have it in the billing provider. This is common for custom plans, free plans that don't require the billing provider subscription, or plans that are not yet available.

To do so, let's add the `custom` flag to the price:

```ts title="index.ts"
{
  id: "enterprise-monthly",
  label: "Contact us!",
  href: "/contact",
  interval: RecurringInterval.MONTH,
  custom: true,
  type: BillingModel.RECURRING,
}
```

Here's the full example:

```ts title="index.ts"
export const config = billingConfigSchema.parse({
  ...
  plans: [
    {
      id: PricingPlanType.PREMIUM,
      name: "Premium",
      description: "Become a power user and gain benefits",
      badge: "Bestseller",
      prices: [
        {
          id: "premium-monthly",
          label: "Contact us!",
          href: "/contact",
          interval: RecurringInterval.MONTH,
          custom: true,
          type: BillingModel.RECURRING,
        },
      ],
    },
  ],
  ...
}) satisfies BillingConfig;
```

As you can see, the plan is now a custom plan. The UI will display the plan in the pricing table, but it won't be available for purchase.

We do this by adding the following fields:

* `custom`: A flag to indicate that the plan is custom. This will prevent the plan from being available for purchase. It's set to `false` by default.
* `label`: This is used to display the label in the pricing table instead of the price.
* `href`: The link to the page where the user can contact you. This is used in the pricing table.

<Callout title="Translations supported!">
  All labels and descriptions can be translated using the [internationalization](/docs/web/internationalization/overview) feature. The UI will display the correct translation based on the user's locale.

  ```ts title="index.ts"
  label: "common:contactUs",
  ```

  To make strings translatable, make sure to provide the translation key in the config.
</Callout>

### Discounts

Sometimes, you want to offer a discount to your users. This is done by adding a discount to the price in `discounts` field.

```ts title="index.ts"
export const config = billingConfigSchema.parse({
  ...
  discounts: [
    {
      code: "50OFF",
      type: BillingDiscountType.PERCENT,
      off: 50,
      appliesTo: [
        "price_1PpUagFQH4McJDTlHwsCzOmyT6",
      ],
    },
  ],
  ...
}) satisfies BillingConfig;
```

Let's break down the fields:

* `code`: The code of the discount (e.g., "50OFF", "10% off", etc.) **This must match the code configured in the billing provider**
* `type`: The type of the discount (e.g., `percent`, `amount`, etc.)
* `off`: The amount of the discount (e.g., 50 for 50% off)
* `appliesTo`: The list of prices that the discount applies to. This is the price ID that you've configured above for the price.

This data will allow to display the correct banner in the UI e.g. "10% off for the first 100 customers!" and to apply the discount to the correct price at checkout.

## Adding more products, plans and discounts

Simply add more plans, prices and discounts to the arrays. The UI **should** be able to handle it in most traditional cases. If you have a more complex billing schema, you may need to adjust the UI accordingly.
