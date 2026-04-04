---
title: Paths configuration
description: Learn how to configure the paths of your app.
url: /docs/mobile/configuration/paths
---

# Paths configuration

The paths configuration is set at `apps/mobile/config/paths.ts`. This configuration stores all the paths that you'll be using in your application. It is a convenient way to store them in a central place rather than scatter them in the codebase using magic strings.

It is **unlikely you'll need to change** this unless you're heavily editing the codebase.

```ts title="apps/mobile/config/paths.ts"
const pathsConfig = {
  index: "/",
  setup: {
    welcome: "/welcome",
    auth: {
      login: `${AUTH_PREFIX}/login`,
      register: `${AUTH_PREFIX}/register`,
      forgotPassword: `${AUTH_PREFIX}/password/forgot`,
      updatePassword: `${AUTH_PREFIX}/password/update`,
      error: `${AUTH_PREFIX}/error`,
      join: `${AUTH_PREFIX}/join`,
    },
    steps: {
      start: `${STEPS_PREFIX}/start`,
      required: `${STEPS_PREFIX}/required`,
      skip: `${STEPS_PREFIX}/skip`,
      final: `${STEPS_PREFIX}/final`,
    },
  },
  dashboard: {
    user: {
      index: DASHBOARD_PREFIX,
      ai: `${DASHBOARD_PREFIX}/ai`,
      ...
    }
    ...
  }
} as const;
```

<Callout title="Fully type-safe">
  By declaring the paths as constants, we can use them safely throughout the
  codebase. There is no risk of misspelling or using magic strings.
</Callout>
