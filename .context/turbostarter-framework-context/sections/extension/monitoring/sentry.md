---
title: Sentry
description: Learn how to setup Sentry as your browser extension monitoring provider.
url: /docs/extension/monitoring/sentry
---

# Sentry

[Sentry](https://sentry.io/) is a popular error monitoring and performance tracking platform. It helps you catch and debug issues by collecting exceptions, stack traces, and helpful context from production.

For browser extensions, that context matters even more: errors can happen in multiple runtimes (popup/options UI, background/service worker, and content scripts). Sentry makes it easier to see what failed and where it happened so you can ship fixes with confidence.

<Callout type="warn" title="Prerequisite: Sentry account">
  To use Sentry, create an account and a project first. You can sign up [here](https://sentry.io/signup).
</Callout>

![Sentry banner](/images/docs/web/monitoring/sentry/banner.png)

## Configuration

This section walks you through enabling Sentry for your extension and verifying that errors from the popup, background/service worker, and content scripts are captured reliably.

<Steps>
  <Step>
    ### Create a project

    Create a Sentry [project](https://docs.sentry.io/product/projects/) for the extension (JavaScript / browser). You can do this from the Sentry [projects dashboard](https://sentry.io/settings/account/projects/) via the *Create Project* flow.
  </Step>

  <Step>
    ### Activate Sentry as your monitoring provider

    TurboStarter picks the extension monitoring provider via exports in the monitoring package. To enable Sentry, export the Sentry implementation from the extension monitoring entrypoint:

    ```ts title="index.ts"
    // [!code word:sentry]
    export * from "./sentry";
    export * from "./sentry/env";
    ```

    If you need to customize behavior, the provider implementation lives under `packages/monitoring/extension/src/providers/sentry`.
  </Step>

  <Step>
    ### Set environment variables

    From your Sentry project settings, add the DSN and environment to your extension env file (and to any [CI/build step](/docs/extension/publishing/checklist#build-your-app) that produces your extension bundles):

    ```dotenv title="apps/extension/.env.local"
    VITE_SENTRY_DSN="your-sentry-dsn"
    VITE_SENTRY_ENVIRONMENT="your-project-environment"
    ```
  </Step>
</Steps>

That's it — load the extension, trigger a test error from the popup/background/content script, and confirm it shows up in your [Sentry dashboard](https://sentry.io/settings/account/projects/).

![Sentry error](/images/docs/web/monitoring/sentry/error.jpg)

For advanced options (sampling, releases, extra context), refer to [Sentry's JavaScript docs](https://docs.sentry.io/platforms/javascript/).

<Cards>
  <Card title="Quick Start" href="https://docs.sentry.io/platforms/javascript/" description="docs.sentry.io" />

  <Card title="Manual Setup" href="https://docs.sentry.io/platforms/javascript/install/npm/" description="docs.sentry.io" />
</Cards>

## Uploading source maps

**Source maps** map the bundled/minified JavaScript shipped with your extension back to your original source files. Without them, Sentry stack traces often point to compiled output, which makes debugging across popup/background/content-script runtimes much harder.

<Callout>
  Generating source maps can expose your source code if `.map` files are publicly accessible. Prefer hidden source maps and/or delete them after upload.
</Callout>

Sentry can automatically provide readable stack traces for errors using source maps, requiring a [Sentry auth token](https://docs.sentry.io/account/auth-tokens/).

<Steps>
  <Step>
    ### Install the Sentry Vite plugin

    Install the package `@sentry/vite-plugin` in `apps/extension/package.json` as a dev dependency.

    ```bash
    pnpm i @sentry/vite-plugin -D --filter extension
    ```
  </Step>

  <Step>
    ### Add an auth token for uploads

    Create an [auth token in Sentry](https://docs.sentry.io/account/auth-tokens/) and provide it as an environment variable during builds (locally and in your build environment):

    ```dotenv
    SENTRY_AUTH_TOKEN="your-sentry-auth-token"
    ```
  </Step>

  <Step>
    ### Enable source maps and configure the plugin

    Enable source map generation in your extension build and add `sentryVitePlugin` **after** your other Vite plugins:

    ```ts title="wxt.config.ts"
    import { defineConfig } from "wxt";
    import { sentryVitePlugin } from "@sentry/vite-plugin";

    export default defineConfig({
      /* existing WXT configuration options */
      vite: () => ({
        build: {
          sourcemap: "hidden", // [!code ++] Source map generation must be turned on ("hidden", true, etc.)
        },
        plugins: [
          sentryVitePlugin({
            org: "your-sentry-org",
            project: "your-sentry-project",
            authToken: process.env.SENTRY_AUTH_TOKEN,

            sourcemaps: {
              // As you're enabling client source maps, you probably want to delete them after they're uploaded to Sentry.
              // Set the appropriate glob pattern for your output folder - some glob examples below:
              filesToDeleteAfterUpload: [
                "./**/*.map",
                ".*/**/public/**/*.map",
                "./dist/**/client/**/*.map",
              ],
            },
          }),
        ],
      }),
    });
    ```
  </Step>

  <Step>
    ### Verify uploads with a production build

    The Sentry Vite plugin doesn't upload in dev/watch mode. Run a production build, then trigger a test error in the extension and confirm stack traces resolve to your original source.
  </Step>
</Steps>

Once this is in place, errors from your extension's compiled bundles (popup/options UI, background/service worker, content scripts) should show **readable stack traces** in Sentry, without shipping source maps to end users.

<Cards>
  <Card title="What are source maps?" href="https://web.dev/articles/source-maps" description="web.dev" />

  <Card title="Sentry Vite plugin" href="https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/" description="docs.sentry.io" />
</Cards>
