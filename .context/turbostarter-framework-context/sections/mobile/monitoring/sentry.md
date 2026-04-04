---
title: Sentry
description: Learn how to setup Sentry as your mobile monitoring provider.
url: /docs/mobile/monitoring/sentry
---

# Sentry

[Sentry](https://sentry.io/) is a popular error monitoring platform that captures crashes and exceptions from production devices and helps you debug them with stack traces, breadcrumbs, and user context.

TurboStarter's mobile monitoring layer is provider-agnostic, but Sentry is a great default when you want reliable crash reporting plus readable stack traces in release builds.

<Callout type="warn" title="Prerequisite: Sentry account">
  To use Sentry, create an [account in Sentry](https://sentry.io/signup) first.
</Callout>

![Sentry banner](/images/docs/web/monitoring/sentry/banner.png)

## Configuration

TurboStarter integrates effortlessly with Sentry, so you can capture application errors and analyze performance from development through production. Setting up Sentry as your provider lets you quickly find and fix issues, contributing to a more robust and dependable app.

Follow the steps below to integrate Sentry with your TurboStarter project.

<Steps>
  <Step>
    ### Create a project

    Begin by creating a [project](https://docs.sentry.io/product/projects/) in Sentry. You can set this up from your [dashboard](https://sentry.io/settings/account/projects/) by clicking the *Create Project* button.
  </Step>

  <Step>
    ### Activate Sentry as your monitoring provider

    The monitoring provider to use is determined by the exports in `packages/monitoring/mobile` package. To activate Sentry as your monitoring provider, you need to update the exports in:

    ```ts title="index.ts"
    // [!code word:sentry]
    export * from "./sentry";
    export * from "./sentry/env";
    ```

    If you want to customize the provider, you can find its definition in `packages/monitoring/mobile/src/providers/sentry` directory.
  </Step>

  <Step>
    ### Set environment variables

    Based on your [project settings](https://sentry.io/project/settings), fill the following environment variables in your `.env.local` file in `apps/mobile` directory and your deployment environment (e.g. [EAS build profile](/docs/mobile/publishing/checklist#environment-variables)):

    ```dotenv title="apps/mobile/.env.local"
    EXPO_PUBLIC_SENTRY_DSN="your-sentry-dsn"
    EXPO_PUBLIC_PROJECT_ENVIRONMENT="your-project-environment"
    ```
  </Step>

  <Step>
    ### Wrap your app

    Install the Sentry React Native SDK in the `mobile` workspace.

    ```bash
    pnpm i @sentry/react-native --filter mobile
    ```

    And then wrap the root component of your application with Sentry.wrap:

    ```tsx title="app/_layout.tsx"
    import * as Sentry from "@sentry/react-native";

    export default Sentry.wrap(RootLayout);
    ```

    <Callout>
      TurboStarter initializes the SDK for you based on env + provider exports; you only need to wrap the root component.
    </Callout>
  </Step>
</Steps>

You're all set! Start your app and view any errors or exceptions directly in your [Sentry dashboard](https://sentry.io/settings/account/projects/).

![Sentry error](/images/docs/web/monitoring/sentry/error.jpg)

You can tailor the setup further if needed. For more details, refer to the [official Sentry documentation](https://docs.sentry.io/platforms/react-native/features/).

<Cards>
  <Card title="Quick Start" href="https://docs.sentry.io/platforms/react-native/" description="docs.sentry.io" />

  <Card title="Manual Setup" href="https://docs.sentry.io/platforms/react-native/manual-setup/" description="docs.sentry.io" />
</Cards>

## Uploading source maps

Readable stack traces in Sentry require uploading source maps for release builds. For Expo projects, Sentry recommends enabling **two pieces**:

* the **Sentry Expo config plugin** (uploads during native builds)
* the **Sentry Metro plugin** (adds debug IDs so bundles and source maps match)

### Add the Sentry Expo plugin

Add `@sentry/react-native/expo` plugin to your Expo config (`app.config.ts`):

```ts title="app.config.ts"
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  plugins: [
    [
      "@sentry/react-native/expo",
      {
        url: "https://sentry.io/",
        project: "your-sentry-project",
        organization: "your-sentry-organization",
      },
    ],
  ],
});
```

Then provide an auth token through environment variables (locally in `.env.local` file in `apps/mobile` directory) and your build environment:

```dotenv title="apps/mobile/.env.local"
SENTRY_AUTH_TOKEN="your-sentry-auth-token"
```

### Add the Sentry Metro plugin

To ensure unique Debug IDs are assigned to the generated bundles and source maps, add the Sentry Metro Plugin to the configuration.

Update `metro.config.js` to use `getSentryExpoConfig`:

```js title="metro.config.js"
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

module.exports = config;
```

With the Expo plugin + Metro plugin in place, source maps are uploaded automatically during release native builds and EAS builds (debug builds typically rely on Metro's symbolication).

Take a moment to test your setup by triggering an error in your app, then confirm that source maps are resolving stack traces accurately in your [Sentry dashboard](https://sentry.io/settings/account/projects/). For advanced setup details, troubleshooting, or further customization with React Native and Expo, refer to the [official Sentry documentation](https://docs.sentry.io/platforms/react-native/guides/expo/sourcemaps/).

<Cards>
  <Card title="What are source maps?" href="https://web.dev/articles/source-maps" description="web.dev" />

  <Card title="Uploading source maps" href="https://docs.sentry.io/platforms/react-native/sourcemaps/uploading/expo/" description="docs.sentry.io" />
</Cards>
