---
title: Lemon Squeezy
description: Manage your customers data and subscriptions using Lemon Squeezy.
url: /docs/web/billing/lemon-squeezy
---

# Lemon Squeezy

[Lemon Squeezy](https://lemonsqueezy.com/) is another billing provider available within TurboStarter. Here we'll go through the configuration and how to set it up as a provider for your app.

To switch to Lemon Squeezy, you need to update the exports in:

<Tabs items={["index.ts", "env.ts"]}>
  <Tab value="index.ts">
    ```ts
    // [!code word:lemon-squeezy]
    export * from "./lemon-squeezy";
    ```
  </Tab>

  <Tab value="env.ts">
    ```ts
    // [!code word:lemon-squeezy]
    export * from "./lemon-squeezy/env";
    ```
  </Tab>
</Tabs>

Then, let's configure the integration:

<Steps>
  <Step>
    ## Get API keys

    After you have created your account and a store for [Lemon Squeezy](https://lemonsqueezy.com/), you will need to create a new API key. You can do this by going to the [API page](https://app.lemonsqueezy.com/settings/api) in the settings and clicking on the plus button. You will need to give your API key a name and then click on the *Create* button. Once you have created your API key, you will need to copy the API key to use it in the setup of the integration.

    For local development, make sure to use [Test Mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode) to not mess with the real transactions.
  </Step>

  <Step>
    ## Set environment variables

    You need to set the following environment variables:

    ```dotenv title="apps/web/.env.local"
    LEMONSQUEEZY_API_KEY="" # Your Lemon Squeezy API key
    LEMONSQUEEZY_SIGNING_SECRET="" # Your Lemon Squeezy webhook signing secret
    LEMONSQUEEZY_STORE_ID="" # Your Lemon Squeezy store ID (can be found under Settings > Stores next to your store url, e.g #12345)
    ```

    **Please do not add the secret keys to the .env file in production.** During development, you can place them in `.env.local` as it's not committed to the repository. In production, you can set them in the environment variables of your hosting provider.
  </Step>

  <Step>
    ## Create products

    For your users to choose from the available subscription plans, you need to create those Products first on the [Products page](https://app.lemonsqueezy.com/products). You can create as many products as you want.

    Create one product per plan you want to offer. You can add multiple variant within the product to offer multiple models or different billing intervals.

    ![Lemon Squeezy Products](/images/docs/web/billing/lemon-squeezy/products.webp)

    To offer multiple intervals for each plan, you can use the [Variant](https://docs.lemonsqueezy.com/help/products/variants) feature of Lemon Squeezy. Just create one variant for each interval/model you want to offer.

    ![Lemon Squeezy Variants](/images/docs/web/billing/lemon-squeezy/variants.png)

    <Callout type="warn" title="Match the variant id with configuration">
      You need to make sure that the price ID you set in the configuration matches the ID of the variant you created in Lemon Squeezy.

      [See configuration](/docs/web/billing/configuration#prices) for more information.
    </Callout>
  </Step>

  <Step>
    ## Create a webhook

    To sync the current subscription status or checkout conclusion and other information to your database, you need to set up a webhook.

    The webhook handling code comes ready to use with TurboStarter, you just have to create the webhook in the Lemon Squeezy dashboard and insert the URL for your project.

    To configure a new webhook, go to the [Webhooks page](https://app.lemonsqueezy.com/settings/webhooks) in the Lemon Squeezy settings and click the *Plus* button.

    ![Lemon Squeezy Webhook](/images/docs/web/billing/lemon-squeezy/webhook.png)

    Select the following events:

    * For subscriptions:
      * `subscription_created`
      * `subscription_updated`
      * `subscription_cancelled`
    * For one-off payments:
      * `order_created`

    You will also have to enter a *Signing secret* which you can get by running the following command in your terminal:

    ```bash
    openssl rand -base64 32
    ```

    Copy the generated string and paste it into the *Signing secret* field.

    You also need to add this secret to your environment variables:

    ```dotenv title="apps/web/.env.local"
    LEMONSQUEEZY_WEBHOOK_SECRET=your-signing-secret
    ```

    To get the callback URL for the webhook, you can either use a local development URL or the URL of your deployed app:

    ### Local development

    If you want to test the webhook locally, you can use [ngrok](https://ngrok.com) to create a tunnel to your local machine. Ngrok will then give you a URL that you can use to test the webhook locally.

    To do so, install ngrok and run it with the following command (while your TurboStarter web development server is running):

    ```bash
    ngrok http 3000
    ```

    ![Ngrok](/images/docs/web/billing/stripe/ngrok.png)

    This will give you a URL (see the *Forwarding* output) that you can use to create a webhook in Lemon Squeezy. Just use that url and add `/api/billing/webhook` to it.

    <Card title="Lemon Squeezy Webhooks" description="docs.lemonsqueezy.com" href="https://docs.lemonsqueezy.com/api/webhooks" />

    ### Production deployment

    When going to production, you will need to set the webhook URL and the events you want to listen to in Lemon Squeezy.

    The webhook path is `/api/billing/webhook`. If your app is hosted at `https://myapp.com` then you need to enter `https://myapp.com/api/billing/webhook` as the URL.

    All the relevant events are automatically handled by TurboStarter, so you don't need to do anything else. If you want to handle more events please check [Webhooks](/docs/web/billing/webhooks) for more information.
  </Step>
</Steps>

## Add discount

You can add a discount for your customers that will apply on a specific price.

You can create the discount on [Discounts page](https://app.lemonsqueezy.com/discounts).

![Lemon Squeezy Discounts](/images/docs/web/billing/lemon-squeezy/discount.png)

You can set there a details of discount such as products that it should apply to, amount off, duration, max redemptions and more.

<Card title="Lemon Squeezy Discounts" description="lemonsqueezy.com" href="https://www.lemonsqueezy.com/marketing/discount-codes" />

You need to add also the discount code and details to TurboStarter billing configuration to enable displaying it in the UI, creating checkout sessions with it and calculate prices.

[See discounts configuration](/docs/web/billing/configuration#discounts) for more details.

That's it! 🎉 You have now set up Lemon Squeezy as a billing provider for your app.

Feel free to add more products, prices, discounts and manage your customers data and subscriptions using Lemon Squeezy.

<Callout type="warn" title="Ensure configuration matches">
  Make sure that the data you set in the configuration matches the details of things you created in Lemon Squeezy.

  [See configuration](/docs/web/billing/configuration) for more information.
</Callout>
