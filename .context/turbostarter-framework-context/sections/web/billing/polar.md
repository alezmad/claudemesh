---
title: Polar
description: Manage your customers data and subscriptions using Polar.
url: /docs/web/billing/polar
---

# Polar

[Polar](https://www.polar.com/) is another billing provider available within TurboStarter. Here we'll go through the configuration and how to set it up as a provider for your app.

To switch to Polar, you need to update the exports in:

<Tabs items={["index.ts", "env.ts"]}>
  <Tab value="index.ts">
    ```ts
    // [!code word:polar]
    export * from "./polar";
    ```
  </Tab>

  <Tab value="env.ts">
    ```ts
    // [!code word:polar]
    export * from "./polar/env";
    ```
  </Tab>
</Tabs>

Then, let's configure the integration:

<Steps>
  <Step>
    ## Get the access token

    After you have created your account for [Polar](https://www.polar.com/) and created your store, you will need to get the API key.

    Under the *Settings*, scroll to *Developers* and click "New token". Enter a name for the token, set the expiration duration and select the scopes you want the token to have.

    To keep it simple, you can select all scopes.

    ![Polar Access Token](/images/docs/web/billing/polar/access-token.png)

    For local development, make sure to use [Sandbox Mode](https://docs.polar.sh/integrate/sandbox) to not mess with the real transactions.
  </Step>

  <Step>
    ## Set environment variables

    You need to set the following environment variables:

    ```dotenv title="apps/web/.env.local"
    POLAR_ACCESS_TOKEN="" # Your Polar access token
    POLAR_WEBHOOK_SECRET="" # Your Polar webhook secret
    POLAR_ORGANIZATION_SLUG="" # Your Polar organization slug (can be found under Settings > Organization)
    ```

    **Please do not add the secret keys to the .env file in production.** During development, you can place them in `.env.local` as it's not committed to the repository. In production, you can set them in the environment variables of your hosting provider.
  </Step>

  <Step>
    ## Create products

    For your users to choose from the available subscription plans, you need to create those Products first on the [Products page](https://docs.polar.sh/features/products). You can create as many products as you want.

    ![Polar Products](/images/docs/web/billing/polar/products.png)

    Polar takes a different approach to product variants. Instead of having one product with multiple pricing options, Polar treats each pricing option as a separate product. This simplifies the user experience and API while giving you full flexibility.

    At checkout, customers can choose between different products (like monthly or yearly plans), each with its own pricing and benefits.

    ![Polar Product Variants](/images/docs/web/billing/polar/variants.png)

    <Callout type="warn" title="Match the product id with configuration">
      You need to make sure that the price ID you set in the configuration matches the ID of the product you created in Polar.

      [See configuration](/docs/web/billing/configuration#prices) for more information.
    </Callout>
  </Step>

  <Step>
    ## Create a webhook

    To sync the current subscription status or checkout conclusion and other information to your database, you need to set up a webhook.

    The webhook handling code comes ready to use with TurboStarter, you just have to create the webhook in the Polar dashboard and insert the URL for your project.

    To configure a new webhook, go to the [Webhooks page](https://docs.polar.sh/integrate/webhooks/endpoints) in the Polar settings and click the *Add endpoint* button.

    ![Polar Webhook](/images/docs/web/billing/polar/webhook.png)

    Select the following events:

    * For subscriptions:
      * `subscription.created`
      * `subscription.updated`
      * `subscription.canceled`
      * `subscription.revoked`
    * For one-off payments:
      * `order.created`

    You will also have to enter a *Secret* which you can get by running the following command in your terminal:

    ```bash
    openssl rand -base64 32
    ```

    Copy the generated string and paste it into the *Secret* field.

    You also need to add this secret to your environment variables:

    ```dotenv title="apps/web/.env.local"
    POLAR_WEBHOOK_SECRET=your-generated-secret
    ```

    To get the URL for the webhook, you can either use a local development URL or the URL of your deployed app:

    ### Local development

    If you want to test the webhook locally, you can use [ngrok](https://ngrok.com) to create a tunnel to your local machine. Ngrok will then give you a URL that you can use to test the webhook locally.

    To do so, install ngrok and run it with the following command (while your TurboStarter web development server is running):

    ```bash
    ngrok http 3000
    ```

    ![Ngrok](/images/docs/web/billing/stripe/ngrok.png)

    This will give you a URL (see the *Forwarding* output) that you can use to create a webhook in Polar. Just use that url and add `/api/billing/webhook` to it.

    <Card title="Polar Webhooks" description="docs.polar.sh" href="https://docs.polar.sh/integrate/webhooks/delivery" />

    ### Production deployment

    When going to production, you will need to set the webhook URL and the events you want to listen to in Polar.

    The webhook path is `/api/billing/webhook`. If your app is hosted at `https://myapp.com` then you need to enter `https://myapp.com/api/billing/webhook` as the URL.

    All the relevant events are automatically handled by TurboStarter, so you don't need to do anything else. If you want to handle more events please check [Webhooks](/docs/web/billing/webhooks) for more information.
  </Step>
</Steps>

## Add discount

You can add a discount for your customers that will apply on a specific price.

You can create the discount under the *Products* page on *Discounts* tab in the Polar dashboard.

![Polar Discount](/images/docs/web/billing/polar/discount.png)

You can set there a details of discount such as products that it should apply to, amount off, duration, max redemptions and more.

<Card title="Polar Discounts" description="docs.polar.sh" href="https://docs.polar.sh/features/discounts" />

You need to add also the discount code and details to TurboStarter billing configuration to enable displaying it in the UI, creating checkout sessions with it and calculate prices.

[See discounts configuration](/docs/web/billing/configuration#discounts) for more details.

That's it! 🎉 You have now set up Polar as a billing provider for your app.

Feel free to add more products, prices, discounts and manage your customers data and subscriptions using Polar.

<Callout type="warn" title="Ensure configuration matches">
  Make sure that the data you set in the configuration matches the details of things you created in Polar.

  [See configuration](/docs/web/billing/configuration) for more information.
</Callout>
