---
title: Environment variables
description: Learn how to configure environment variables.
url: /docs/mobile/configuration/environment-variables
---

# Environment variables

Environment variables are defined in the `.env` file in the root of the repository and in the root of the `apps/mobile` package.

* **Shared environment variables**: Defined in the **root** `.env` file. These are shared between environments (e.g., development, staging, production) and apps (e.g., web, mobile).
* **Environment-specific variables**: Defined in `.env.development` and `.env.production` files. These are specific to the development and production environments.
* **App-specific variables**: Defined in the app-specific directory (e.g., `apps/web`). These are specific to the app and are not shared between apps.
* **Build environment variables**: Not stored in the `.env` file. Instead, they are stored in `eas.json` file used to build app on [Expo Application Services](https://expo.dev/eas).
* **Secret keys**: They're not stored on mobile side, instead [they're defined on the web side.](/docs/web/configuration/environment-variables#secret-keys)

## Shared variables

Here you can add all the environment variables that are shared across all the apps.

To override these variables in a specific environment, please add them to the specific environment file (e.g. `.env.development`, `.env.production`).

```dotenv title=".env.local"
# Shared environment variables

# The database URL is used to connect to your database.
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

# The name of the product. This is used in various places across the apps.
PRODUCT_NAME="TurboStarter"

# The url of the web app. Used mostly to link between apps.
URL="http://localhost:3000"

...
```

## App-specific variables

Here you can add all the environment variables that are specific to the app (e.g. `apps/mobile`).

You can also override the shared variables defined in the root `.env` file.

```dotenv title="apps/mobile/.env.local"
# App-specific environment variables

# Env variables extracted from shared to be exposed to the client in Expo app
EXPO_PUBLIC_SITE_URL="${URL}"
EXPO_PUBLIC_DEFAULT_LOCALE="${DEFAULT_LOCALE}"

# Theme mode and color
EXPO_PUBLIC_THEME_MODE="system"
EXPO_PUBLIC_THEME_COLOR="orange"

# Use this variable to enable or disable password-based authentication. If you set this to true, users will be able to sign up and sign in using their email and password. If you set this to false, the form won't be shown.
EXPO_PUBLIC_AUTH_PASSWORD="true"

...
```

<Callout title="EXPO_PUBLIC_ prefix">
  To make environment variables available in the Expo app code, you need to prefix them with `EXPO_PUBLIC_`. They will be injected to the code during the build process.

  Only environment variables prefixed with `EXPO_PUBLIC_` will be injected.

  [Read more about Expo environment variables.](https://docs.expo.dev/guides/environment-variables/)
</Callout>

## Build environment variables

To allow your app to build properly on [EAS](https://expo.dev/eas) you need to define your environment variables either in your `eas.json` file under corresponding profile (e.g. `preview` or `production`) or directly in the [EAS platform](https://docs.expo.dev/eas/environment-variables/):

![EAS environment variables](/images/docs/mobile/eas-environment-variables.png)

Then, when you trigger build, correct environment variables will be injected to your mobile app code ensuring that everything is working correctly.

[Check EAS documentation for more details.](https://docs.expo.dev/eas/environment-variables/)

## Secret keys

Secret keys and sensitive information are to be **never** stored on the mobile app code.

<Callout title="What does this mean?">
  It means that you will need to add the secret keys to the **web app, where the API is deployed.**

  The mobile app should only communicate with the backend API, which is typically part of the web app. The web app is responsible for handling sensitive operations and storing secret keys securely.

  [See web documentation for more details.](/docs/web/configuration/environment-variables#secret-keys)

  This is not a TurboStarter-specific requirement, but a best practice for security for any
  application. Ultimately, it's your choice.
</Callout>
