---
title: Configuration
description: Learn how to configure internationalization in TurboStarter.
url: /docs/web/internationalization/configuration
---

# Configuration

The default global configuration is defined in the `@turbostarter/i18n` package and shared across all applications. You can override it in each app to customize the internationalization setup for that specific app.

The configuration is defined in the `packages/i18n/src/config.ts` file:

```ts title="packages/i18n/src/config.ts"
export const config = {
  locales: ["en", "es"],
  defaultLocale: "en",
  namespaces: [
    "common",
    "admin",
    "organization",
    "dashboard",
    "auth",
    "billing",
    "marketing",
    "validation",
  ],
  cookie: "locale",
} as const;
```

Let's break down the configuration options:

* `locales`: An array of all supported locales.
* `defaultLocale`: The default locale to use if no other locale is detected.
* `namespaces`: An array of all namespaces used in the application.
* `cookie`: The name of the cookie to store the detected locale (acts as a cache).

## Translation files

The core of the whole internationalization setup is the translation files. They are stored in the `packages/i18n/src/translations` directory and are used to store the translations for each locale and namespace.

Each directory represents a locale and contains a set of files, each corresponding to a specific namespace (e.g. `en/common.json`). Inside we define the keys and values for the translations.

```ts title="packages/i18n/src/translations/en/common.json"
{
  "hello": "Hello, world!"
}
```

That way we can ensure that we have a single source of truth for the translations and we can use them consistently in all the applications.

## Locales

The `locales` array in the configuration defines the list of supported languages in your application. Each locale is represented by a string that uniquely identifies the language.

To add a new locale, you need to:

1. Add the new locale to the `locales` array in the configuration.
2. Create a new directory in the `packages/i18n/src/translations` directory.
3. Create a new file in the new directory for each namespace and add the translations for the new locale.

For example, if you want to add the `fr` locale, you need to:

1. Add `fr` to the `locales` array in the configuration.
2. Create a new directory in the `packages/i18n/src/translations` directory.
3. Create a new file for each namespace in the created directory and add the translations for the new locale.

### Fallback locale

The `defaultLocale` option in the configuration defines the fallback locale. If a translation is not found for a specific locale, the fallback locale will be used.

We can also override this setting in each [app configuration](/docs/web/configuration/app) by configuring the `locale` property.

## Namespaces

`namespaces` are used to group translations by feature or module. This helps in organizing the translations and makes it easier to maintain them.

### Why not one big namespace?

Using multiple namespaces instead of one large namespace helps with:

1. **Performance:** load translations on-demand instead of all at once, reducing the initial bundle size.
2. **Organization:** group translations by feature (e.g., `auth`, `common`, `dashboard`).
3. **Maintenance:** easier to update and manage smaller translation files.
4. **Development:** better TypeScript support and team collaboration.

For example, you might structure your namespaces like this:

<Tabs items={["Common", "Auth", "Billing"]}>
  <Tab value="Common">
    ```ts title="packages/i18n/src/translations/en/common.json"
    {
      "hello": "Hello, world!"
    }
    ```
  </Tab>

  <Tab value="Auth">
    ```ts title="packages/i18n/src/translations/en/auth.json"
    {
      "login": "Login",
      "register": "Register"
    }
    ```
  </Tab>

  <Tab value="Billing">
    ```ts title="packages/i18n/src/translations/en/billing.json"
    {
      "invoice": "Invoice",
      "payment": "Payment",
      "subscription": "Subscription"
    }
    ```
  </Tab>
</Tabs>

Remember that while you can create as many namespaces as needed, it's important to maintain a balance - too many namespaces can lead to unnecessary complexity, while too few might defeat the purpose of separation.

## Routing

TurboStarter implements locale-based routing by placing pages under the `[locale]` folder. However, the default locale (usually `en`) is not prefixed in the URL for better SEO and user experience.

For example, with English as the default locale and Polish as an additional language:

* `/dashboard` → English version (default locale)
* `/pl/dashboard` → Polish version

The app also automatically detects the user's preferred language through cookies, HTML `lang` attribute, and browser's `Accept-Language` header.

This ensures a seamless experience where users get content in their preferred language while maintaining clean URLs for the default locale.

<Callout>
  You can override the locale by manually setting the cookie or by navigating to
  a URL with a different locale prefix.
</Callout>
