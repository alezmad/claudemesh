---
title: Environment variables
description: Learn how to configure environment variables.
url: /docs/extension/configuration/environment-variables
---

# Environment variables

Environment variables are defined in the `.env` file in the root of the repository and in the root of the `apps/extension` package.

* **Shared environment variables**: Defined in the **root** `.env` file. These are shared between environments (e.g., development, staging, production) and apps (e.g., web, extension).
* **Environment-specific variables**: Defined in `.env.development` and `.env.production` files. These are specific to the development and production environments.
* **App-specific variables**: Defined in the app-specific directory (e.g., `apps/extension`). These are specific to the app and are not shared between apps.
* **Bundle-specific variables**: Specific to the [bundle target](https://wxt.dev/guide/essentials/config/environment-variables.html#built-in-environment-variables) (e.g. `.env.safari`, `.env.firefox`) or [bundle tag](https://wxt.dev/guide/essentials/config/environment-variables.html#built-in-environment-variables) (e.g. `.env.testing`)
* **Build environment variables**: Not stored in the `.env` file. Instead, they are stored in the environment variables of the CI/CD system.
* **Secret keys**: They're not stored on the extension side, instead [they're defined on the web side.](/docs/web/configuration/environment-variables#secret-keys)

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

Here you can add all the environment variables that are specific to the app (e.g. `apps/extension`).

You can also override the shared variables defined in the root `.env` file.

```dotenv title="apps/extension/.env.local"
# App-specific environment variables

# Env variables extracted from shared to be exposed to the client in WXT (Vite) extension
VITE_SITE_URL="${URL}"
VITE_DEFAULT_LOCALE="${DEFAULT_LOCALE}"

# Theme mode and color
VITE_THEME_MODE="system"
VITE_THEME_COLOR="orange"

...
```

<Callout title="VITE_ prefix">
  To make environment variables available in the browser extension code, you need to prefix them with `VITE_`. They will be injected to the code during the build process.

  Only environment variables prefixed with `VITE_` will be injected.

  [Read more about Vite environment variables.](https://vite.dev/guide/env-and-mode.html#env-files)
</Callout>

## Bundle-specific variables

WXT also provides environment variables specific to a certain [build target](https://wxt.dev/guide/essentials/config/environment-variables.html#built-in-environment-variables) or [build tag](https://wxt.dev/guide/essentials/config/environment-variables.html#built-in-environment-variables) when creating the final bundle. Given the following build command:

```json title="package.json"
"scripts": {
  "build": "wxt build -b firefox --mode testing"
}
```

The following env files will be considered, ordered by priority:

* `.env.firefox`
* `.env.testing`
* `.env`

You shouldn't worry much about this, as TurboStarter comes with already configured build processes for all the major browsers.

## Build environment variables

To allow your extension to build properly on CI you need to define your environment variables on your CI/CD system (e.g. [Github Actions](https://docs.github.com/en/actions/learn-github-actions/environment-variables)).

TurboStarter comes with predefined Github Actions workflow used to build and submit your extension to the stores. It's located in `.github/workflows/publish-extension.yml` file.

To correctly set up the build environment variables, you need to define them under `env` section and then add them as a [secrets](http://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) to your repository.

```yaml title="publish-extension.yml"
...

jobs:
  extension:
    name: 🚀 Publish extension
    runs-on: ubuntu-latest
    environment: Production
    env:
      VITE_SITE_URL: ${{ secrets.SITE_URL }}

  ...

```

We'll go through the whole process of building and publishing the extension in the [publishing guide](/docs/extension/publishing/checklist).

## Secret keys

Secret keys and sensitive information are to be **never** stored on the extension app code.

<Callout title="What does this mean?">
  It means that you will need to add the secret keys to the **web app, where the API is deployed.**

  The browser extension should only communicate with the backend API, which is typically part of the web app. The web app is responsible for handling sensitive operations and storing secret keys securely.

  [See web documentation for more details.](/docs/web/configuration/environment-variables#secret-keys)

  This is not a TurboStarter-specific requirement, but a best practice for security for any
  application. Ultimately, it's your choice.
</Callout>
