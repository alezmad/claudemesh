---
title: App configuration
description: Learn how to setup the overall settings of your app.
url: /docs/mobile/configuration/app
---

# App configuration

When configuring your app, you'll need to define settings in different places depending on which provider will use them (e.g., Expo, EAS).

## App configuration

Let's start with the core settings for your app. These settings are **crucial** as they're used by Expo and EAS to build your app, determine its store presence, prepare updates, and more.

This configuration includes essential details like the official name, description, scheme, store IDs, splash screen configuration, and more.

You'll define these settings in `apps/mobile/app.config.ts`. Make sure to follow the [Expo config schema](https://docs.expo.dev/versions/latest/config/app/) when setting this up.

Here is an example of what the config file looks like:

```ts title="apps/mobile/app.config.ts"
import { ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "TurboStarter",
  slug: "turbostarter",
  scheme: "turbostarter",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],
  sdkVersion: "51.0.0",
  platforms: ["ios", "android"],
  updates: {
    fallbackToCacheTimeout: 0,
  },
  newArchEnabled: true,
  ios: {
    bundleIdentifier: "your.bundle.identifier",
    supportsTablet: false,
  },
  android: {
    package: "your.bundle.identifier",
    adaptiveIcon: {
      monochromeImage: "./public/images/icon/android/monochrome.png",
      foregroundImage: "./public/images/icon/android/adaptive.png",
      backgroundColor: "#0D121C",
    },
  },
  extra: {
    eas: {
      projectId: "your-project-id",
    },
  },
  experiments: {
    tsconfigPaths: true,
    typedRoutes: true,
  },
  plugins: ["expo-router", ["expo-splash-screen", SPLASH]],
});
```

Make sure to replace the values with your own and take your time to set everything correctly.

<Card title="Configure with app config" description="docs.expo.dev" href="https://docs.expo.dev/workflow/configuration/" />

### Internal configuration

The same as for the [web app](/docs/web/configuration/app), and [extension](/docs/extension/configuration/app), we're defining the internal app config, which stores some overall variables for your application (that can't be read from Expo config).

The recommendation is to **not update this directly** - instead, please define the environment variables and override the default behavior. The configuration is strongly typed so you can use it safely accross your codebase - it'll be validated at build time.

```ts title="apps/mobile/src/config/app.ts"
import env from "env.config";

export const appConfig = {
  locale: env.EXPO_PUBLIC_DEFAULT_LOCALE,
  url: env.EXPO_PUBLIC_SITE_URL,
  theme: {
    mode: env.EXPO_PUBLIC_THEME_MODE,
    color: env.EXPO_PUBLIC_THEME_COLOR,
  },
} as const;
```

For example, to set the mobile app default theme color, you'd update the following variable:

```dotenv title=".env.local"
EXPO_PUBLIC_THEME_COLOR="yellow"
```

<Callout type="warn" title="Do NOT use process.env!">
  Do NOT use `process.env` to get the values of the variables. Variables
  accessed this way are not validated at build time, and thus the wrong variable
  can be used in production.
</Callout>

## EAS configuration

To properly build and publish your app, you need to define settings for the EAS build service.

This is done in `apps/mobile/eas.json` and it must follow the [EAS config scheme](https://docs.expo.dev/eas/json/).

Here is an example of what the config file looks like:

```json title="apps/mobile/eas.json"
{
  "cli": {
    "version": ">= 4.1.2"
  },
  "build": {
    "base": {
      "node": "20.15.0",
      "pnpm": "9.6.0",
      "ios": {
        "resourceClass": "m-medium"
      },
      "env": {
        "EXPO_PUBLIC_DEFAULT_LOCALE": "en",
        "EXPO_PUBLIC_AUTH_PASSWORD": "true",
        "EXPO_PUBLIC_AUTH_MAGIC_LINK": "false",
        "EXPO_PUBLIC_THEME_MODE": "system",
        "EXPO_PUBLIC_THEME_COLOR": "orange"
      }
    },
    ...
    "preview": {
      "extends": "base",
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "env": {
        "APP_ENV": "test",
      }
    },
    "production": {
      "extends": "base",
      "env": {
        "APP_ENV": "production",
      }
    }
    ...
  },
}
```

Make sure to also fill all the [environment variables](/docs/mobile/configuration/environment-variables) with the correct values for your project and correct environment, otherwise your app won't build and you won't be able to publish it.

<Card title="Configure EAS Build with eas.json" description="docs.expo.dev" href="https://docs.expo.dev/build/eas-json/" />
