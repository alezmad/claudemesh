---
title: Supabase
description: Learn how to set up Supabase as the database (and optional storage) provider for your TurboStarter project.
url: /docs/extension/recipes/supabase
---

# Supabase

[Supabase](https://supabase.com) is an open-source backend platform built on top of PostgreSQL that provides a managed database, storage, and other features out of the box.

You can adopt Supabase incrementally - start with just the pieces you need (for example, database only, or database + storage) and add more features over time. There's no requirement to integrate everything at once.

In this guide, we'll walk you through the process of setting up Supabase as a provider for your TurboStarter project. This could include using it as a [database](https://supabase.com/docs/guides/database), [storage](https://supabase.com/docs/guides/storage), [edge runtime for your API](https://supabase.com/docs/guides/functions) and more.

## Prerequisites

Before you start, make sure you have:

* **TurboStarter project** cloned locally with dependencies installed (you can use our [CLI](/docs/web/cli) to create a new project in seconds)
* **Supabase account** - you can create one at [supabase.com](https://supabase.com/sign-up)
* Basic familiarity with the core database docs:
  * [Database overview](/docs/web/database/overview)
  * [Migrations](/docs/web/database/migrations)
  * [Database client](/docs/web/database/client)

<Steps>
  <Step>
    ## Create a new Supabase project

    1. Go to the [Supabase dashboard](https://supabase.com).
    2. Create a **new project** (choose a strong database password and a region close to your users).
    3. Supabase will automatically provision a **PostgreSQL database** for you.

    ![Create a new Supabase project](/images/docs/web/recipes/supabase/create-project.png)

    Optionally, you can customize the **Security options** by choosing the **Only Connection String** option - it will opt out of autogenerating API for tables inside your database. It's not needed for TurboStarter setup, but of course you can still leverage it for your custom use-cases.

    ![Security options](/images/docs/web/recipes/supabase/security-options.png)

    Once the project is ready, you can fetch the connection string.
  </Step>

  <Step>
    ## Get the database connection string

    In the Supabase dashboard:

    1. Open your project.
    2. Click on the **Connect** button at the top.
    3. Locate the **connection string** for your chosen ORM (it will be under the **ORMs** tab).

    ![Connect application](/images/docs/web/recipes/supabase/connect-app.png)

    Copy this value - you'll use it as your `DATABASE_URL`.

    <Callout title="Replace password placeholder" type="warn">
      In your Supabase connection string, you can see a placeholder like `[YOUR-PASSWORD]`. Make sure to replace this with the actual password you set when creating your Supabase project.
    </Callout>
  </Step>

  <Step>
    ## Configure environment variables

    TurboStarter reads database connection settings from the **root** `.env.local` file and uses them inside the `@turbostarter/db` package.

    Create (or update) the `.env.local` file in the **monorepo root**:

    ```dotenv title=".env.local"
    DATABASE_URL="postgres://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[aws-region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
    ```

    Replace:

    * `YOUR-PROJECT-REF` with your Supabase project ref
    * `YOUR-PASSWORD` with the database password you set when creating the project
    * `aws-region` with the region shown in the Supabase connection string

    <Callout>
      These variables are validated in the `@turbostarter/db` package and used to create Drizzle client for your database.
    </Callout>

    For more background on how `DATABASE_URL` is used, see [Database overview](/docs/web/database/overview).
  </Step>

  <Step>
    ## Setup your Supabase database

    With `DATABASE_URL` now pointing to Supabase, you can apply the existing TurboStarter schema to your Supabase database.

    From the monorepo root, run:

    ```bash
    pnpm with-env pnpm --filter @turbostarter/db db:migrate
    ```

    This will:

    * Use your Supabase `DATABASE_URL` from `.env.local`
    * Run all pending SQL migrations from `packages/db/migrations`
    * Create the full TurboStarter schema (users, billing, demo tables, etc.) in Supabase

    If you're actively iterating on the schema, you can generate new migrations and apply them as described in [Migrations](/docs/web/database/migrations).

    <Callout title="Seeding your database" type="info">
      After running your migrations, you may want to seed your database with initial data (such as demo users or organizations). You can do this by running the following command:

      ```bash
      pnpm with-env pnpm turbo db:seed
      ```

      This will populate your Supabase database with some example data you can use to test your application.
    </Callout>
  </Step>

  <Step>
    ## Use Supabase Storage as S3-compatible storage

    TurboStarter's storage layer is designed to work seamlessly with **any S3-compatible provider**. In this section, we'll show how to use [Supabase Storage](/docs/web/storage/overview) as your application's file storage back-end.

    Supabase Storage provides a simple, S3-compatible API and is a great choice if you're already using Supabase for your database.

    ### Create a storage bucket

    1. In the Supabase dashboard, go to **Storage → Buckets**.
    2. Click **Create bucket** (name it whatever you want, for example `avatars` or `uploads`).
    3. Adjust settings based on your needs (e.g. limit the maximum file size, specify the allowed file types, etc.)

    ![Create a new bucket](/images/docs/web/recipes/supabase/create-bucket.png)

    You can create multiple buckets (for documents, images, videos, etc.) if needed.

    ### Generate S3 access keys in Supabase dashboard

    1. Go to **Storage → S3 → Access keys**.
    2. Click **New access key**.
    3. Give it a descriptive name and create the key.
    4. Copy the **Access key ID** and **Secret access key** to use in your application.

    ![Generate S3 access keys](/images/docs/web/recipes/supabase/s3-keys.png)

    ### Configure S3 environment variables for Supabase Storage

    In your weba application's `.env.local`, add (or update) the S3 configuration used by TurboStarter's storage layer:

    ```dotenv title=".env.local"
    S3_REGION="us-east-1"
    S3_BUCKET="avatars"
    S3_ENDPOINT="https://[YOUR-PROJECT-REF].supabase.co/storage/v1/s3"
    S3_ACCESS_KEY_ID="your-access-key-id"
    S3_SECRET_ACCESS_KEY="your-secret-access-key"
    ```

    These variables integrate directly with the storage configuration described in:

    * [Storage overview](/docs/web/storage/overview)
    * [Storage configuration](/docs/web/storage/configuration)

    Once set, existing TurboStarter file upload flows (e.g. user avatars, organization logos) will use Supabase Storage via presigned URLs.
  </Step>

  <Step>
    ## Run your API on Supabase Edge Functions

    As we're using a [Hono](https://hono.dev) as our API server, you can deploy it as a Supabase Edge Function so it runs close to your users.

    At a high level:

    1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and initialize a Supabase project locally with `supabase init`.
    2. Create a new [Edge Function](https://supabase.com/docs/guides/functions/quickstart) (for example `hono-backend`) with `supabase functions new hono-backend`.
    3. Inside the generated function (for example `supabase/functions/hono-backend/index.ts`), set up a basic Hono app and export it via `Deno.serve(app.fetch)`:

    ```ts
    import { Hono } from "jsr:@hono/hono";

    // change this to your function name
    const functionName = "hono-backend";
    const app = new Hono().basePath(`/${functionName}`);

    app.get("/hello", (c) => c.text("Hello from hono-server!"));

    Deno.serve(app.fetch);
    ```

    4. Run the function locally with `supabase start` and `supabase functions serve --no-verify-jwt`, then call it from your TurboStarter app using the local or deployed function URL.
    5. When you're ready, deploy the function with `supabase functions deploy` (or `supabase functions deploy hono-backend`) and manage it using the Supabase dashboard, as described in the [Supabase Edge Functions docs](https://supabase.com/docs/guides/functions).

    This is entirely optional, but it's a great fit for lightweight APIs, webhooks, and other serverless logic you want to run alongside your Supabase project.
  </Step>

  <Step>
    ## Explore additional Supabase features

    Supabase is a full Postgres development platform, so beyond the database and storage pieces wired up above you can gradually add more features as your app grows ([see the Supabase homepage](https://supabase.com/) for an overview).

    Some features that fit especially well with TurboStarter's design are:

    * [Realtime](https://supabase.com/docs/guides/realtime) - built on [Postgres replication](https://www.postgresql.org/docs/current/runtime-config-replication.html), so you can stream changes from your existing TurboStarter tables (inserts, updates, deletes) into live UIs without changing how you manage schema or RLS. You still define tables and policies via `@turbostarter/db`, and opt into Realtime on top.
    * [Vector](https://supabase.com/docs/guides/vector) - powered by the [pgvector](https://github.com/pgvector/pgvector) extension and stored in regular Postgres tables, making it easy to integrate semantic search or AI features while keeping everything in the same migrations and Drizzle models you already use in TurboStarter. We're using it extensively in our dedicated [AI Kit](/ai).
    * [Cron](https://supabase.com/docs/guides/functions/cron) - enables you to schedule background jobs and periodic tasks with [pg\_cron](https://github.com/citusdata/pg_cron). You can define cron jobs for things like scheduled database cleanups, sending emails, report generation, or any recurring logic, all managed alongside your TurboStarter app with full Postgres integration.

    Because these features are all layered on top of Postgres, you can introduce them incrementally and keep managing everything through your familiar workflow.
  </Step>

  <Step>
    ## Start the development server

    With the database and other services configured to use Supabase, you can start TurboStarter as usual from the monorepo root:

    ```bash
    pnpm dev
    ```

    TurboStarter will now:

    * Use **Supabase Postgres** as your database through `DATABASE_URL`
    * Use **Supabase Storage** as your file storage through the S3-compatible endpoint
    * Leverage **Supabase Edge Functions** (for example, with Hono) for your serverless backend
  </Step>
</Steps>

That's it! You can now start building your application with Supabase as your main provider. Explore the [Supabase documentation](https://supabase.com/docs) for more features and best practices.
