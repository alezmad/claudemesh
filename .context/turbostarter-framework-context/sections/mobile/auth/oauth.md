---
title: OAuth
description: Get started with social authentication.
url: /docs/mobile/auth/oauth
---

# OAuth

Better Auth supports almost **30** (!) different [OAuth providers](https://www.better-auth.com/docs/concepts/oauth). They can be easily configured and enabled in the kit without any additional configuration needed.

<Callout title="Everything configured!">
  TurboStarter provides you with all the configuration required to handle OAuth providers responses from your app:

  * redirects
  * middleware
  * confirmation API routes

  You just need to configure one of the below providers on their side and set correct credentials as environment variables in your TurboStarter app.
</Callout>

![OAuth providers](/images/docs/web/auth/social-providers.png)

Third Party providers need to be configured, managed and enabled fully on the provider's side. TurboStarter just needs the correct credentials to be set as environment variables in your app and passed to the [authentication API configuration](/docs/web/auth/configuration#api).

To enable OAuth providers in your TurboStarter app, you need to:

1. Set up an OAuth application in the provider's developer console (like [Apple Developer Portal](https://developer.apple.com/account/), [Google Cloud Console](https://console.cloud.google.com/), [Github Developer Settings](https://github.com/settings/developers) or any other provider you want to use)
2. Configure the provider's credentials as environment variables in your app. For example, for Google OAuth:

```dotenv title="apps/web/.env.local"
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Then, pass it to the authentication configuration in `packages/auth/src/server.ts`:

```ts title="server.ts"
export const auth = betterAuth({
  ...

  socialProviders: {
    [SocialProvider.GOOGLE]: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },

  ...
});
```

<Callout title="Remember to add your app scheme as trusted origin">
  For mobile apps, we need to define a trusted origin using an app scheme instead of a classic URL. App schemes (like `turbostarter://`) are used for [deep linking](https://docs.expo.dev/guides/linking/) users to specific screens in your app after authentication.

  To find your app scheme, take a look at `apps/mobile/app.config.ts` file and then add it to your auth server configuration:

  ```ts title="server.ts"
  export const auth = betterAuth({
    ...

    trustedOrigins: ["turbostarter://**"],

    ...
  });
  ```

  Adding your app scheme to the trusted origins list is crucial for security - it prevents CSRF attacks and blocks malicious open redirects by ensuring only requests from approved origins (your app) are allowed through.

  [Read more about auth security in Better Auth's documentation.](https://www.better-auth.com/docs/reference/security)
</Callout>

Also, we included some native integrations (["Sign in with Apple"](/docs/mobile/auth/oauth/apple) for iOS and ["Sign in with Google"](/docs/mobile/auth/oauth/google) for Android) to make the sign-in process smoother and faster for the user.
