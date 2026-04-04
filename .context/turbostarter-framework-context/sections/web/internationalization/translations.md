---
title: Translating app
description: Learn how to translate your application to multiple languages.
url: /docs/web/internationalization/translations
---

# Translating app

TurboStarter provides a flexible and powerful translation system that works seamlessly across your entire application. Whether you're working with React Server Components (RSC), client-side components, or server-side rendering, you can easily integrate translations to create a fully internationalized experience.

The translation system supports:

* **Server components (RSC)** for efficient server-side translations
* **Client components** for dynamic language switching
* **Server-side rendering** for SEO-friendly translated content

## Server components (RSC)

To get the translations in a server component, you can use the `getTranslation` method:

```tsx
import { getTranslation } from "@turbostarter/i18n";

export default async function MyComponent() {
  const { t } = await getTranslation();

  return <div>{t("common:hello")}</div>;
}
```

There is also a possibility to use the [Trans](https://react.i18next.com/latest/trans-component) component, which could be useful e.g. for interpolating variables:

```tsx
import { Trans } from "@turbostarter/i18n";
import { withI18n } from "@turbostarter/i18n/with-i18n";

const Page = () => {
  return <Trans i18nKey="common:hello" components={{ bold: <b /> }} />;
};

export default withI18n(Page);
```

Although, to make it available in the server component, you need to wrap it with the `withI18n` HOC.

Given that server components are rendered in parallel, it's uncertain which one will render first. Therefore, it's crucial to initialize the translations before rendering the server component on each page/layout.

## Client components

For client components, you can use the `useTranslation` hook from the `@turbostarter/i18n` package:

```tsx
"use client";

import { useTranslation } from "@turbostarter/i18n";

export default function MyComponent() {
  const { t } = useTranslation();

  return <div>{t("common:hello")}</div>;
}
```

That's the simplest way to get the translations in a client component.

## Server-side

In all other places (e.g. metadata, API routes, sitemaps etc.) you can use the `getTranslation` method to get the translations server-side:

```ts
import { getTranslation } from "@turbostarter/i18n";

export const generateMetadata = async () => {
  const { t } = await getTranslation();

  return {
    title: t("common:title"),
  };
};
```

It automatically checks the user's preferred locale and uses the correct translation.

## Language switcher

TurboStarter ships with a language customizer component that allows you to switch between languages. You can import and use the `LocaleCustomizer` component and drop it anywhere in your application to allow users to change the language seamlessly.

```tsx
import { LocaleCustomizer } from "@turbostarter/ui-web/i18n";

export default function MyComponent() {
  return <LocaleCustomizer />;
}
```

The component automatically displays all languages configured in your i18n settings. When a user switches languages, it will:

1. Update the URL to include the new locale prefix (e.g. `/es/dashboard`)
2. Store the selected locale in a cookie for persistence
3. Refresh translations across the entire application
4. Preserve the current page/route during the language switch

This provides a seamless localization experience without requiring any additional configuration.

## Best practices

Here are some recommended best practices for managing translations in your application:

* Use descriptive translation keys that follow a logical hierarchy

  ```ts
  // ✅ Good
  "auth.login.title";

  // ❌ Bad
  "loginTitleForAuth";
  ```

* Keep translations organized in separate namespaces/files based on features or sections

  ```
  translations/
  ├── en/
  │   ├── auth.json
  │   └── common.json
  └── pl/
      ├── auth.json
      └── billing.json
  ```

* Avoid hardcoding text strings - always use translation keys even for seemingly static content

* Always provide a fallback language (usually English) for when translations are missing

* Use pluralization and interpolation features when dealing with dynamic content

  ```ts
  // Pluralization
  t("items", { count: 2 }); // "2 items"

  // Interpolation
  t("welcome", { name: "John" }); // "Welcome, John!"
  ```

* Regularly review and clean up unused translation keys to keep files maintainable

* Use TypeScript for type-safe translation keys
