---
title: Protected routes
description: Learn how to protect your API routes.
url: /docs/web/api/protected-routes
---

# Protected routes

Hono has built-in support for [middlewares](https://hono.dev/docs/guides/middleware), which are functions that can be used to modify the context or execute code before or after a route handler is executed.

That's how we can secure our API endpoints from unauthorized access. Below are some examples of you can leverage middlewares to protect your API routes.

## Authenticated access

After validating the user's authentication status, we store their data in the context using [Hono's built-in context](https://hono.dev/docs/api/context). This allows us to access the user's information in subsequent middleware and procedures without having to re-validate the session.

Here's an example of middleware that validates whether the user is currently logged in and stores their data in the context:

```ts title="middleware.ts"
export const enforceAuth = createMiddleware<{
  Variables: {
    user: User;
  };
}>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = session?.user ?? null;

  if (!user) {
    throw new HTTPException(HttpStatusCode.UNAUTHORIZED, {
      message: "You need to be logged in to access this feature!",
    });
  }

  c.set("user", user);
  await next();
});
```

Then we can use our defined middleware to protect endpoints by adding it before the route handler:

```ts title="billing/router.ts"
export const billingRouter = new Hono().get(
  "/customer",
  enforceAuth,
  async (c) => c.json(await getCustomerByUserId(c.var.user.id)),
);
```

## Role-based access

In most cases, you will want to restrict access to certain endpoints based on the user's role.

You can achieve this by creating a middleware that will check if the user has the required role and then pass the execution to the next middleware or procedure.

E.g. for admin endpoints we want to ensure that the user has the `admin` role:

```ts title="middleware.ts"
export const enforceAdmin = createMiddleware<{
  Variables: {
    user: User;
  };
}>(async (c, next) => {
  const user = c.var.user;

  if (!hasAdminPermission(user)) {
    throw new HttpException(HttpStatusCode.FORBIDDEN, {
      message: "You need to be an admin to access this feature!",
    });
  }

  await next();
});
```

Then we can use our defined middleware to protect endpoints by adding it before the route handler:

```ts title="admin/router.ts"
export const adminRouter = new Hono().get(
  "/users",
  enforceAuth,
  enforceAdmin,
  (c) => c.json(...),
);
```

## Feature-based access

When developing your API you may want to restrict access to certain features based on the user's current subscription plan. (e.g. only users with "Pro" plan can access teams).

You can achieve this by creating a middleware that will check if the user has access to the feature and then pass the execution to the next middleware or procedure:

```ts title="middleware.ts"
export const enforceFeatureAvailable = (feature: Feature) =>
  createMiddleware<{
    Variables: {
      user: User;
    };
  }>(async (c, next) => {
    const { data: customer } = await getCustomerById(c.var.user.id);

    const hasFeature = isFeatureAvailable(customer, feature);

    if (!hasFeature) {
      throw new HTTPException(HttpStatusCode.PAYMENT_REQUIRED, {
        message: "Upgrade your plan to access this feature!",
      });
    }

    await next();
  });
```

Use it within your procedure the same way as we did with `enforceAuth` middleware:

```ts title="teams/router.ts"
export const teamsRouter = new Hono().get(
  "/",
  enforceAuth,
  enforceFeatureAvailable(FEATURES.PRO.TEAMS),
  (c) => c.json(...),
);
```

These are just examples of what you can achieve with Hono middlewares. You can use them to add any kind of logic to your API (e.g. [logging](https://hono.dev/docs/middleware/builtin/logger), [caching](https://hono.dev/docs/middleware/builtin/cache), etc.)
