---
title: Checklist
description: Let's publish your TurboStarter app to stores!
url: /docs/mobile/publishing/checklist
---

# Checklist

When you're ready to publish your TurboStarter app to stores, follow this checklist.

This process may take a few hours and some trial and error, so buckle up - you're almost there!

<Steps>
  <Step>
    ## Create database instance

    **Why it's necessary?**

    A production-ready database instance is essential for storing your application's data securely and reliably in the cloud. [PostgreSQL](https://www.postgresql.org/) is the recommended database for TurboStarter due to its robustness, features, and wide support.

    **How to do it?**

    You have several options for hosting your PostgreSQL database:

    * [Supabase](/docs/mobile/recipes/supabase) - Provides a fully managed Postgres database with additional features
    * [Vercel Postgres](https://vercel.com/storage/postgres) - Serverless SQL database optimized for Vercel deployments
    * [Neon](https://neon.tech/) - Serverless Postgres with automatic scaling
    * [Turso](https://turso.tech/) - Edge database built on libSQL with global replication
    * [DigitalOcean](https://www.digitalocean.com/products/managed-databases) - Managed database clusters with automated failover

    Choose a provider based on your needs for:

    * Pricing and budget
    * Geographic region availability
    * Scaling requirements
    * Additional features (backups, monitoring, etc.)
  </Step>

  <Step>
    ## Migrate database

    **Why it's necessary?**

    Pushing database migrations ensures that your database schema in the remote database instance is configured to match TurboStarter's requirements. This step is crucial for the application to function correctly.

    **How to do it?**

    You basically have two possibilities of doing a migration:

    <Tabs items={["Using Github Actions (recommended)", "Running locally"]}>
      <Tab value="Using Github Actions (recommended)">
        TurboStarter comes with predefined Github Action to handle database migrations. You can find its definition in the `.github/workflows/publish-db.yml` file.

        What you need to do is to set your `DATABASE_URL` as a [secret for your Github repository](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).

        Then, you can run the workflow which will publish the database schema to your remote database instance.

        [Check how to run Github Actions workflow.](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)
      </Tab>

      <Tab value="Running locally">
        You can also run your migrations locally, although this is not recommended for production.

        To do so, set the `DATABASE_URL` environment variable to your database URL (that comes from your database provider) in `.env.local` file and run the following command:

        ```bash
        pnpm with-env pnpm --filter @turbostarter/db db:migrate
        ```

        This command will run the migrations and apply them to your remote database.

        [Learn more about database migrations.](/docs/web/database/migrations)
      </Tab>
    </Tabs>
  </Step>

  <Step>
    ## (Optional) Set up Firebase project

    **Why it's necessary?**

    Setting up a Firebase project is optional, and depends on which features your app is using. For example, if you want to use [Analytics](/docs/mobile/analytics/overview) with [Google Analytics](/docs/mobile/analytics/configuration#google-analytics), setting up a Firebase project is required.

    **How to do it?**

    Please refer to the [Firebase project](/docs/mobile/installation/firebase) section on how to set up and configure your Firebase project.
  </Step>

  <Step>
    ## Set up web backend API

    **Why it's necessary?**

    Setting up the backend is necessary to have a place to store your data and to have other features work properly (e.g. authentication, billing or storage).

    **How to do it?**

    Please refer to the [web deployment checklist](/docs/web/deployment/checklist) on how to set up and deploy the web app backend to production.
  </Step>

  <Step>
    ## Environment variables

    **Why it's necessary?**

    Setting the correct environment variables is essential for the application to function correctly. These variables include API keys, database URLs, and other configuration details required for your app to connect to various services.

    **How to do it?**

    Use our `.env.example` files to get the correct environment variables for your project. Then add them to your project on the [EAS platform](https://docs.expo.dev/eas/environment-variables/) for correct profile and environment:

    ![EAS environment variables](/images/docs/mobile/eas-environment-variables.png)

    Alternatively, you can add them to your `eas.json` file under correct profile.

    ```json title="eas.json"
    {
      "profiles": {
        "base": {
          "env": {
            "EXPO_PUBLIC_DEFAULT_LOCALE": "en",
            "EXPO_PUBLIC_AUTH_PASSWORD": "true",
            "EXPO_PUBLIC_AUTH_MAGIC_LINK": "false",
            "EXPO_PUBLIC_THEME_MODE": "system",
            "EXPO_PUBLIC_THEME_COLOR": "orange"
          }
        },
        "production": {
          "extends": "base",
          "autoIncrement": true,
          "env": {
            "APP_ENV": "production",
            "EXPO_PUBLIC_SITE_URL": "https://www.turbostarter.dev",
          }
        }
      }
    }
    ```
  </Step>

  <Step>
    ## Build your app

    <Callout title="Prerequisite: EAS account">
      Building your app requires an EAS account and project. If you don't have one, you can create it by following the steps [here](https://expo.dev/eas).
    </Callout>

    **Why it's necessary?**

    Building your app is necessary to create a standalone application bundle that can be published to the stores.

    **How to do it?**

    You basically have two possibilities to build a bundle for your app:

    <Tabs items={["Using Github Actions (recommended)", "Running locally"]}>
      <Tab value="Using Github Actions (recommended)">
        TurboStarter comes with predefined Github Action to handle building your app on EAS. You can find its definition in the `.github/workflows/publish-mobile.yml` file.

        What you need to do is to set your `EXPO_TOKEN` as a [secret for your Github repository](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions). You can obtain it from your EAS account, in the [Access Tokens](https://expo.dev/settings/access-tokens) section.

        Then, you can run the workflow which will build the app on [EAS platform](https://expo.dev/eas).

        [Check how to run Github Actions workflow.](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)
      </Tab>

      <Tab value="Running locally">
        You can also run your build locally, although this is not recommended for production.

        To do it, you'll need to have [EAS CLI](https://github.com/expo/eas-cli) installed on your machine. You can install it by running the following command:

        ```bash
        npm install -g eas-cli
        ```

        Then, run the following command to build your app with the `production` profile:

        ```bash
        eas build --profile production --platform all
        ```

        This will build the app for both platforms (iOS and Android) and output the results in your app folder.
      </Tab>
    </Tabs>
  </Step>

  <Step>
    ## Submit to stores

    **Why it's necessary?**

    Releasing your app to the stores is essential for making it accessible and discoverable by your users. This allows users to find, install, and trust your application through official channels.

    **How to do it?**

    We've prepared dedicated guides for each store that TurboStarter supports out-of-the-box, please refer to the following pages:

    <Cards>
      <Card title="App Store" href="/docs/mobile/publishing/ios" description="Publish your app to the Apple App Store." />

      <Card title="Google Play" href="/docs/mobile/publishing/android" description="Publish your app to the Google Play Store." />
    </Cards>
  </Step>
</Steps>

That's it! Your app is now live and accessible to your users, good job! 🎉

<Callout title="Other things to consider">
  * Optimize your store listings with compelling descriptions, keywords, screenshots and preview videos
  * Remove placeholder content and replace with your final production content
  * Update all visual branding including favicon, scheme, splash screen and app icons
</Callout>
