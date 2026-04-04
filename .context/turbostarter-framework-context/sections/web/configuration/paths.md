---
title: Paths configuration
description: Learn how to configure the paths of your app.
url: /docs/web/configuration/paths
---

# Paths configuration

The paths configuration is set at `apps/web/config/paths.ts`. This configuration stores all the paths that you'll be using in your application. It is a convenient way to store them in a central place rather than scatter them in the codebase using magic strings.

It is **unlikely you'll need to change** this unless you're heavily editing the codebase.

```ts title="apps/web/config/paths.ts"
const pathsConfig = {
  index: "/",
  marketing: {
    pricing: "/pricing",
    contact: "/contact",
    blog: {
      index: BLOG_PREFIX,
      post: (slug: string) => `${BLOG_PREFIX}/${slug}`,
    },
    legal: (slug: string) => `${LEGAL_PREFIX}/${slug}`,
  },
  auth: {
    login: `${AUTH_PREFIX}/login`,
    register: `${AUTH_PREFIX}/register`,
    join: `${AUTH_PREFIX}/join`,
    forgotPassword: `${AUTH_PREFIX}/password/forgot`,
    updatePassword: `${AUTH_PREFIX}/password/update`,
    error: `${AUTH_PREFIX}/error`,
  },
  dashboard: {
    user: {
      index: DASHBOARD_PREFIX,
      ai: `${DASHBOARD_PREFIX}/ai`,
      settings: {
        index: `${DASHBOARD_PREFIX}/settings`,
        security: `${DASHBOARD_PREFIX}/settings/security`,
        billing: `${DASHBOARD_PREFIX}/settings/billing`,
      },
    },
    ...
  },
  ...,
} as const;
```

<Callout title="Fully type-safe">
  By declaring the paths as constants, we can use them safely throughout the
  codebase. There is no risk of misspelling or using magic strings.
</Callout>
