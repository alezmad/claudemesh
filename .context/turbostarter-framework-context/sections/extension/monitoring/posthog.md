---
title: PostHog
description: Learn how to setup PostHog as your browser extension monitoring provider.
url: /docs/extension/monitoring/posthog
---

# PostHog

[PostHog](https://posthog.com/) is a product analytics platform that also supports monitoring capabilities like error tracking and session replay. In extensions, it's especially useful when you want to connect “what broke” with “what the user did” right before the issue occurred.

TurboStarter keeps monitoring behind a unified API, so you can route exception captures from your popup, background, and content scripts to PostHog without rewriting the call sites.

<Callout type="warn" title="Prerequisite: PostHog account">
  To use PostHog as your monitoring provider, you'll need a PostHog instance. You can use [PostHog Cloud](https://app.posthog.com/signup) or [self-host](https://posthog.com/docs/self-host).
</Callout>

<Callout type="info" title="You can also use it for extension analytics">
  PostHog is also supported as an analytics provider for the extension. If you want to track in-extension events, see the [analytics overview](/docs/extension/analytics/overview) and the [PostHog analytics configuration](/docs/extension/analytics/configuration#posthog).
</Callout>

![PostHog banner](/images/docs/web/monitoring/posthog/banner.jpg)

## Configuration

Here you'll configure PostHog as the monitoring provider for your extension so exceptions from the popup, background/service worker, and content scripts show up with enough context to debug.

<Steps>
  <Step>
    ### Create a project

    Create a PostHog [project](https://app.posthog.com/project/settings) for your extension. You can do this from the [PostHog dashboard](https://app.posthog.com) via the *New Project* action.
  </Step>

  <Step>
    ### Activate PostHog as your monitoring provider

    TurboStarter picks the extension monitoring provider through exports in the monitoring package. To route captures to PostHog, export the PostHog implementation from the extension monitoring entrypoint:

    ```ts title="index.ts"
    // [!code word:posthog]
    export * from "./posthog";
    export * from "./posthog/env";
    ```
  </Step>

  <Step>
    ### Set environment variables

    Add your PostHog project key (and host, if you're not using the default cloud region) to your extension env. Set these locally and in whatever build environment produces your extension bundles:

    ```dotenv title="apps/extension/.env.local"
    VITE_POSTHOG_KEY="your-posthog-project-api-key"
    VITE_POSTHOG_HOST="https://us.i.posthog.com"
    ```
  </Step>
</Steps>

That's it — load the extension, trigger a test error from the popup/background/content script, and confirm events are arriving in your PostHog project.

![PostHog error](/images/docs/web/monitoring/posthog/error.png)

If you want to go beyond basic capture (session replay, feature flags, richer context), follow PostHog's web/extension guidance.

<Cards>
  <Card title="Error tracking" href="https://posthog.com/docs/error-tracking" description="posthog.com" />

  <Card title="Web error tracking installation" href="https://posthog.com/docs/error-tracking/installation/web" description="posthog.com" />
</Cards>

## Uploading source maps

**Source maps** map the minified/bundled JavaScript shipped with your extension back to your original source code. Without them, stack traces in PostHog often point at compiled output, which makes debugging much slower.

<Callout>
  PostHog’s source map flow for web builds relies on injecting metadata into the bundled assets. You must deploy/ship the injected assets, otherwise PostHog can’t match captured errors to the uploaded symbol sets.
</Callout>

For extensions built with Vite (which [WXT](https://wxt.dev/) is using under the hood), the high-level flow is:

* generate `.map` files during the production build
* inject PostHog metadata into the built assets
* upload the injected source maps to PostHog

<Steps>
  <Step>
    ### Install the PostHog CLI

    Install the CLI globally:

    ```bash
    npm install -g @posthog/cli
    ```
  </Step>

  <Step>
    ### Authenticate the CLI

    Authenticate interactively:

    ```bash
    posthog-cli login
    ```

    In CI, you can authenticate with environment variables:

    ```dotenv
    POSTHOG_CLI_HOST="https://us.posthog.com"
    POSTHOG_CLI_ENV_ID="your-posthog-project-id"
    POSTHOG_CLI_TOKEN="your-personal-api-key"
    ```
  </Step>

  <Step>
    ### Build with source maps enabled

    Make sure your extension build outputs source maps by modifying your `wxt.config.ts` file.

    ```ts title="wxt.config.ts"
    import { defineConfig } from "wxt";

    export default defineConfig({
      /* existing WXT configuration options */
      vite: () => ({
        build: {
          sourcemap: "hidden", // [!code ++] Source map generation must be turned on ("hidden", true, etc.)
        },
      }),
    });
    ```

    After building, you should have `.js` and `.js.map` files in your output directory.
  </Step>

  <Step>
    ### Inject PostHog metadata into the built assets

    Inject release/chunk metadata so PostHog can associate uploaded maps with the shipped bundles:

    ```bash
    posthog-cli sourcemap inject --directory ./path/to/assets --project my-extension --version 1.2.3
    ```
  </Step>

  <Step>
    ### Upload source maps

    Upload the injected source maps to PostHog:

    ```bash
    posthog-cli sourcemap upload --directory ./path/to/assets
    ```
  </Step>

  <Step>
    ### Verify injection and uploads

    After deployment, confirm your production bundles include the injected comment (for example `//# chunkId=...`) and verify symbol sets exist in your PostHog project settings.
  </Step>
</Steps>

With this in place, PostHog can symbolicate extension errors (popup/options UI, background/service worker, and content scripts) so stack traces point back to your original source files.

<Cards>
  <Card title="What are source maps?" href="https://web.dev/articles/source-maps" description="web.dev" />

  <Card title="Upload source maps for web" href="https://posthog.com/docs/error-tracking/upload-source-maps/web" description="posthog.com" />
</Cards>
