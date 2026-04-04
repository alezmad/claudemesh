---
title: Configuration
description: Configure authentication for your application.
url: /docs/mobile/auth/configuration
---

# Configuration

TurboStarter supports multiple different authentication methods:

* **Password** - the traditional email/password method
* **Magic Link** - passwordless email link authentication
* **Anonymous** - guest mode for users who want to proceed anonymously
* **OAuth** - OAuth providers, [Apple](https://www.better-auth.com/docs/authentication/apple), [Google](https://www.better-auth.com/docs/authentication/google) and [Github](https://www.better-auth.com/docs/authentication/github) are set up by default

All authentication methods are enabled by default, but you can easily customize them to your needs. You can enable or disable any method, and configure them according to your requirements.

<Callout>
  Remember that you can mix and match these methods or add new ones - for
  example, you can have both password and magic link authentication enabled at
  the same time, giving your users more flexibility in how they authenticate.
</Callout>

Authentication configuration can be customized through a simple configuration file. The following sections explain the available options and how to configure each authentication method based on your requirements.

## API

To enable new authentication method or add some plugin, you'd need to update the API configuration. Please refer to [web authentication configuration](/docs/web/auth/configuration) for more information as it's not strictly related with mobile app configuration.

<Callout title="Remember to add your app scheme as trusted origin">
  For mobile apps, we need to define an [authentication trusted origin](https://www.better-auth.com/docs/reference/security#trusted-origins) using a mobile app scheme instead.

  App schemes (like `turbostarter://`) are used for [deep linking](https://docs.expo.dev/guides/linking/) users to specific screens in your app after authentication.

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

## UI

We have separate configuration that determines what is displayed to your users in the **UI**. It's set at `apps/mobile/config/auth.ts`.

The recommendation is to **not update this directly** - instead, please define the environment variables and override the default behavior.

```ts title="apps/mobile/config/auth.ts"
import env from "env.config";
import { Platform } from "react-native";

import { SocialProvider, authConfigSchema } from "@turbostarter/auth";

import type { AuthConfig } from "@turbostarter/auth";

export const authConfig = authConfigSchema.parse({
  providers: {
    password: env.EXPO_PUBLIC_AUTH_PASSWORD,
    magicLink: env.EXPO_PUBLIC_AUTH_MAGIC_LINK,
    anonymous: env.EXPO_PUBLIC_AUTH_ANONYMOUS,
    oAuth: [
      Platform.select({
        android: SocialProvider.GOOGLE,
        ios: SocialProvider.APPLE,
      }),
      SocialProvider.GITHUB,
    ],
  },
}) satisfies AuthConfig;
```

The configuration is also validated using the Zod schema, so if something is off, you'll see the errors.

For example, if you want to switch from password to magic link, you'd change the following environment variables:

```dotenv title=".env.local"
EXPO_PUBLIC_AUTH_PASSWORD=false
EXPO_PUBLIC_AUTH_MAGIC_LINK=true
```

To display third-party providers in the UI, you need to set the `oAuth` array to include the provider you want to display. The default is Google and Github.

```tsx title="apps/web/config/auth.ts"
providers: {
    ...
    oAuth: [
      Platform.select({
        android: SocialProvider.GOOGLE,
        ios: SocialProvider.APPLE,
      }),
      SocialProvider.GITHUB,
    ],
    ...
},
```

You can even display specific providers for specific platforms - for example, you can display Google authentication for Android and Apple authentication for iOS.

## Third party providers

To enable third-party authentication providers, you'll need to:

1. Set up an OAuth application in the provider's developer console (like [Apple Developer Portal](https://developer.apple.com/account/), [Google Cloud Console](https://console.cloud.google.com/), [Github Developer Settings](https://github.com/settings/developers) or any other provider you want to use)
2. Configure the corresponding environment variables in your TurboStarter **API (web) application**

Each OAuth provider requires its own set of credentials and environment variables. Please refer to the [Better Auth documentation](https://better-auth.com/docs/concepts/oauth) for detailed setup instructions for each supported provider.

<Callout title="Multiple environments">
  Make sure to set both development and production environment variables
  appropriately. Your OAuth provider may require different callback URLs for
  each environment.
</Callout>
