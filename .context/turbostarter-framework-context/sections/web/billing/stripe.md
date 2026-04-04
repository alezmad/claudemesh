---
title: Stripe
description: Manage your customers data and subscriptions using Stripe.
url: /docs/web/billing/stripe
---

# Stripe

[Stripe](https://stripe.com) is the default billing provider for TurboStarter. Here we'll go through the configuration and how to set it up as a provider for your app.

<Steps>
  <Step>
    ## Get API keys

    After you have created your account for [Stripe](https://stripe.com), you will need to get the API key. You can do this by going to the [API page](https://dashboard.stripe.com/apikeys) in the dashboard. Here you will find the *Secret key* and the *Publishable key*. You will need the *Secret key* for the integration to work.

    For local development, make sure to use [Test Mode](https://docs.stripe.com/test-mode) to not mess with the real transactions.
  </Step>

  <Step>
    ## Set environment variables

    You need to set the following environment variables:

    ```dotenv title="apps/web/.env.local"
    STRIPE_SECRET_KEY="" # Your Stripe secret key
    STRIPE_WEBHOOK_SECRET="" # The secret key of the webhook you created (see below)
    ```

    **Please do not add the secret keys to the .env file in production.** During development, you can place them in `.env.local` as it's not committed to the repository. In production, you can set them in the environment variables of your hosting provider.
  </Step>

  <Step>
    ## Create products

    For your users to choose from the available subscription plans, you need to create those Products first on the [Products page](https://dashboard.stripe.com/products). You can create as many products as you want.

    Create one product per plan you want to offer. You can add multiple prices within this product to offer multiple models or different billing intervals.

    ![Stripe Products](/images/docs/web/billing/stripe/products.webp)

    <Callout type="warn" title="Match the price id with configuration">
      You need to make sure that the price ID you set in the configuration matches the ID of the price you created in Stripe.

      [See configuration](/docs/web/billing/configuration) for more information.
    </Callout>
  </Step>

  <Step>
    ## Create a webhook

    To sync the current subscription status or checkout conclusion and other information to your database, you need to set up a webhook.

    The webhook code comes ready to use with TurboStarter, you just have to create the webhook in the Stripe dashboard and insert the URL for your project.

    To configure a new webhook, go to the [Webhooks page](https://dashboard.stripe.com/webhooks) in the Stripe settings and click the Add endpoint button.

    ![Stripe Webhook](/images/docs/web/billing/stripe/webhook.png)

    Select the following events:

    * For subscriptions:
      * `customer.subscription.created`
      * `customer.subscription.updated`
      * `customer.subscription.deleted`
    * For one-off payments:
      * `checkout.session.completed`

    To get the URL for the webhook, you can either use a local development URL or the URL of your deployed app:

    ### Local development

    There are two ways to test the webhook during local development:

    <Tabs items={["Stripe CLI", "Tunnel"]}>
      <Tab value="Stripe CLI">
        The Stripe CLI which allows you to listen to Stripe events straight to your own localhost. You can install and use the CLI using a variety of methods, but we recommend using official way to do it.

        [Install the Stripe CLI](https://docs.stripe.com/stripe-cli)

        Then - login to your Stripe account using the project you want to run:

        ```bash
        stripe login
        ```

        Copy the webhook secret displayed in the terminal and set it as the `STRIPE_WEBHOOK_SECRET` environment variable in your `apps/web/.env.local` file:

        ```dotenv title="apps/web/.env.local"
        STRIPE_WEBHOOK_SECRET=*your-secret-key*
        ```

        Now, you can listen to Stripe events running the following command:

        ```bash
        stripe listen --forward-to localhost:3000/api/billing/webhook
        ```

        This will forward all the Stripe events to your local endpoint.

        <Callout type="warn" title="Not receiving events?">
          **If you have not logged in** - the first time you set it up, you are required to sign in. This is a one-time process. Once you sign in, you can use the CLI to listen to Stripe events.

          **Please sign in and then re-run the command.** Now, you can listen to Stripe events.

          If you're not receiving events, please make sure that:

          * the webhook secret is correct
          * the account you signed in is the same as the one you're using in your app
        </Callout>

        You can even trigger the event manually for testing purposes:

        ```bash
        stripe trigger customer.subscription.created
        ```

        <Card title="Stripe CLI" description="docs.stripe.com" href="https://docs.stripe.com/stripe-cli" />
      </Tab>

      <Tab value="Tunnel">
        If you want to test the webhook locally, you can use [ngrok](https://ngrok.com) to create a tunnel to your local machine. Ngrok will then give you a URL that you can use to test the webhook locally.

        To do so, install ngrok and run it with the following command (while your TurboStarter web development server is running):

        ```bash
        ngrok http 3000
        ```

        ![Ngrok](/images/docs/web/billing/stripe/ngrok.png)

        This will give you a URL (see the *Forwarding* output) that you can use to create a webhook in Stripe. Just use that url and add `/api/billing/webhook` to it.

        <Card title="Stripe Webhooks" description="docs.stripe.com" href="https://docs.stripe.com/webhooks" />
      </Tab>
    </Tabs>

    ### Production deployment

    When going to production, you will need to set the webhook URL and the events you want to listen to in Stripe.

    The webhook path is `/api/billing/webhook`. If your app is hosted at `https://myapp.com` then you need to enter `https://myapp.com/api/billing/webhook` as the URL.

    All the relevant events are automatically handled by TurboStarter, so you don't need to do anything else. If you want to handle more events please check [Webhooks](/docs/web/billing/webhooks) for more information.
  </Step>

  <Step>
    ## Configure Stripe Customer Portal

    Stripe requires you to set up the Customer Portal so that users can manage their billing information, invoices and plan settings from there.

    You can do it [under the following link.](https://dashboard.stripe.com/settings/billing/portal)

    ![Stripe Customer Portal](/images/docs/web/billing/stripe/customer-portal.png)

    1. Please make sure to enable the setting that lets users switch plans
    2. Configure the behavior of the cancellation according to your needs
  </Step>
</Steps>

## Add discount

You can add a discount for your customers that will apply on a specific price.

<Steps>
  <Step>
    ### Create coupon

    First, you'd need to create a coupon on the [Coupons page](https://dashboard.stripe.com/coupons).

    ![Stripe Coupons](/images/docs/web/billing/stripe/coupon.png)

    You can set there a details of discount such as prices that it should apply to, amount off, duration, max redemptions and more.
  </Step>

  <Step>
    ### Add promotion code

    To enable using code during checkout you need to get a promotion code. You can define it on the same page as the coupon and give some user-friendly name to it.

    ![Stripe Promotion Code](/images/docs/web/billing/stripe/promotion-code.png)

    This code will be auto-applied at new checkout sessions.

    <Card title="Stripe Discounts" description="docs.stripe.com" href="https://docs.stripe.com/checkout/custom-checkout/add-discounts" />
  </Step>

  <Step>
    ### Configure discount

    You need to add also the discount code and details to TurboStarter billing configuration to enable displaying it in the UI, creating checkout sessions with it and calculate prices.

    [See discounts configuration](/docs/web/billing/configuration#discounts) for more details.
  </Step>
</Steps>

That's it! 🎉 You have now set up Stripe as a billing provider for your app.

Feel free to add more products, prices, discounts and manage your customers data and subscriptions using Stripe.

<Callout type="warn" title="Ensure configuration matches">
  Make sure that the data you set in the configuration matches the details of things you created in Stripe.

  [See configuration](/docs/web/billing/configuration) for more information.
</Callout>
