---
title: Checklist
description: Let's publish your TurboStarter extension to stores!
url: /docs/extension/publishing/checklist
---

# Checklist

When you're ready to publish your TurboStarter extension to stores, follow this checklist.

This process may take a few hours and some trial and error, so buckle up - you're almost there!

<Steps>
  <Step>
    ## Create database instance

    **Why it's necessary?**

    A production-ready database instance is essential for storing your application's data securely and reliably in the cloud. [PostgreSQL](https://www.postgresql.org/) is the recommended database for TurboStarter due to its robustness, features, and wide support.

    **How to do it?**

    You have several options for hosting your PostgreSQL database:

    * [Supabase](/docs/extension/recipes/supabase) - Provides a fully managed Postgres database with additional features
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

    You basically have two possibilities for doing a migration:

    <Tabs items={["Using GitHub Actions (recommended)", "Running locally"]}>
      <Tab value="Using GitHub Actions (recommended)">
        TurboStarter comes with a predefined GitHub Action to handle database migrations. You can find its definition in the `.github/workflows/publish-db.yml` file.

        What you need to do is set your `DATABASE_URL` as a [secret for your GitHub repository](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).

        Then, you can run the workflow which will publish the database schema to your remote database instance.

        [Check how to run GitHub Actions workflow.](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)
      </Tab>

      <Tab value="Running locally">
        You can also run your migrations locally, although this is not recommended for production.

        To do so, set the `DATABASE_URL` environment variable to your database URL (that comes from your database provider) in the `.env.local` file and run the following command:

        ```bash
        pnpm with-env pnpm --filter @turbostarter/db db:migrate
        ```

        This command will run the migrations and apply them to your remote database.

        [Learn more about database migrations.](/docs/web/database/migrations)
      </Tab>
    </Tabs>
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

    Setting the correct environment variables is essential for the extension to function correctly. These variables include API keys, database URLs, and other configuration details required for your extension to connect to various services.

    **How to do it?**

    Use our `.env.example` files to get the correct environment variables for your project. Then add them to your CI/CD provider (e.g. [GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)) as a [secret](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).
  </Step>

  <Step>
    ## Build your app

    **Why it's necessary?**

    Building your extension is necessary to create a standalone extension bundle that can be published to the stores.

    **How to do it?**

    You basically have two possibilities to build a bundle for your extension:

    <Tabs items={["Using GitHub Actions (recommended)", "Running locally"]}>
      <Tab value="Using GitHub Actions (recommended)">
        TurboStarter comes with a predefined GitHub Action to handle building your extension for submission. You can find its definition in the `.github/workflows/publish-extension.yml` file.

        [Check how to run GitHub Actions workflow.](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)

        This will also save the `.zip` file as an [artifact](https://docs.github.com/en/actions/guides/storing-workflow-data-as-artifacts) of the workflow run, so you can download it from there and submit your extension to stores (if configured).
      </Tab>

      <Tab value="Running locally">
        You can also run your build locally, although this is not recommended for production.

        To do it, run the following command:

        ```bash
        pnpm turbo build --filter=extension
        ```

        This will build the extension and package it into a `.zip` file. You can find the output in the `build` folder.
      </Tab>
    </Tabs>
  </Step>

  <Step>
    ## Submit to stores

    **Why it's necessary?**

    Publishing your extension to the stores is required to make it discoverable and accessible to your users. This is the official distribution channel where users can find, install, and trust your extension.

    **How to do it?**

    We've prepared dedicated guides for each store that TurboStarter supports out-of-the-box, please refer to the following pages:

    <Cards>
      <Card title="Chrome Web Store" href="/docs/extension/publishing/chrome" description="Publish your extension to Google Chrome Web Store." />

      <Card title="Firefox Add-ons" href="/docs/extension/publishing/firefox" description="Publish your extension to Mozilla Firefox Add-ons." />

      <Card title="Edge Add-ons" href="/docs/extension/publishing/edge" description="Publish your extension to Microsoft Edge Add-ons." />
    </Cards>
  </Step>
</Steps>

That's it! Your extension is now live and accessible to your users, good job! 🎉

<Callout title="Other things to consider">
  * Optimize your store listing description, keywords, and other relevant information for the stores.
  * Remove the placeholder content in the extension or replace it with your own.
  * Update the favicon, scheme, store images, and logo with your own branding.
</Callout>
