---
title: Internationalization
description: Learn how to localize and translate your API.
url: /docs/web/api/internationalization
---

# Internationalization

Since TurboStarter provides fully featured [internationalization](/docs/web/internationalization/overview) out of the box, you can easily localize not only the frontend but also the API layer. This can be useful when you need to fetch localized data from the database or send emails in different languages.

Let's explore possibilities of this feature.

## Request-based localization

To get the locale for the current request, you can leverage the `localize` middleware:

```ts title="email/router.ts"
const emailRouter = new Hono().get("/", localize, (c) => {
  const locale = c.var.locale;

  // do something with the locale
});
```

Inside it, we're setting the `locale` variable in the current request context, making it available to the procedure.

## Error handling

When handling errors in an internationalized API, you'll want to ensure error messages are properly translated for your users. TurboStarter provides built-in support for localizing error messages using error codes and a special `onError` hook.

That's why it's recommended to use error codes instead of direct messages in your throw statements:

```ts
throw new HttpException(HttpStatusCode.UNAUTHORIZED, {
  code: "auth:error.unauthorized",
  /* 👇 optional */
  message: "You are not authorized to access this resource.",
});
```

The error code will then be used to retrieve the localized message, and the returned response from your API will look like this:

```json
{
  "code": "auth:error.unauthorized",
  /* 👇 localized based on request's locale */
  "message": "You are not authorized to access this resource.",
  "path": "/api/auth/login",
  "status": 401,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Then, you can either use the returned code to get the localized message in your frontend, or simply use the returned message as is.
