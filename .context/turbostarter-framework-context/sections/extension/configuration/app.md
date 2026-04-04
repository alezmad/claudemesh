---
title: App configuration
description: Learn how to setup the overall settings of your extension.
url: /docs/extension/configuration/app
---

# App configuration

The application configuration is set at `apps/extension/src/config/app.ts`. This configuration stores some overall variables for your application.

This allows you to host multiple apps in the same monorepo, as every application defines its own configuration.

The recommendation is to **not update this directly** - instead, please define the environment variables and override the default behavior. The configuration is strongly typed so you can use it safely accross your codebase - it'll be validated at build time.

```ts title="apps/extension/src/config/app.ts"
import env from "env.config";

export const appConfig = {
  name: env.VITE_PRODUCT_NAME,
  url: env.VITE_SITE_URL,
  locale: env.VITE_DEFAULT_LOCALE,
  theme: {
    mode: env.VITE_THEME_MODE,
    color: env.VITE_THEME_COLOR,
  },
} as const;
```

For example, to set the extension default theme color, you'd update the following variable:

```dotenv title=".env.local"
VITE_THEME_COLOR="yellow"
```

<Callout type="warn" title="Do NOT use process.env!">
  Do NOT use `process.env` to get the values of the variables. Variables
  accessed this way are not validated at build time, and thus the wrong variable
  can be used in production.
</Callout>

## WXT config

To configure framework-specific settings, you can use the `wxt.config.ts` file. You can configure a lot of options there, such as [manifest](/docs/extension/configuration/manifest), [project structure](https://wxt.dev/guide/essentials/project-structure.html) or even [underlying Vite config](https://wxt.dev/guide/essentials/config/vite.html):

```ts title="wxt.config.ts"
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "app",
  outDir: "build",
  modules: [],
  manifest: {
    // Put manifest changes here
  },
  vite: () => ({
    // Override config here, same as `defineConfig({ ... })`
    // inside vite.config.ts files
  }),
});
```

Make sure to setup it correctly, as it's the main source of config for your development, build and publishing process.
