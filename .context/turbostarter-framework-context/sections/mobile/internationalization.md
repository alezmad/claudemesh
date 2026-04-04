---
title: Internationalization
description: Learn how to internationalize your mobile app.
url: /docs/mobile/internationalization
---

# Internationalization

TurboStarter mobile uses [i18next](https://www.i18next.com/) and [expo-localization](https://docs.expo.dev/versions/latest/sdk/localization/) for internationalization. This powerful combination allows you to leverage both i18next's mature translation framework and Expo's native device locale detection.

<Callout title="Why this combination?">
  While i18next handles the translation management, expo-localization provides
  seamless integration with the device's locale settings. This means your app
  can automatically detect and adapt to the user's preferred language, while
  still maintaining the flexibility to override it when needed.
</Callout>

The mobile app's internationalization is configured to work out of the box with:

* Automatic device language detection
* Right-to-left (RTL) layout support
* Locale-aware date and number formatting
* Fallback language handling

You can read more about the underlying technologies in their documentation:

* [i18next documentation](https://www.i18next.com/overview/getting-started)
* [expo-localization documentation](https://docs.expo.dev/versions/latest/sdk/localization/)

![i18next logo](/images/docs/i18next.jpg)

## Configuration

The global configuration is defined in the `@turbostarter/i18n` package and shared across all applications. You can read more about it in the [web configuration](/docs/web/internationalization/configuration) documentation.

By default, the locale is automatically detected based on the user's device settings. You can override it and set the default locale of your mobile app in the [app configuration](/docs/mobile/configuration/app) file.

## Translating app

To translate individual components and screens, you can use the `useTranslation` hook.

```tsx
import { useTranslation } from "@turbostarter/i18n";

export default function MyComponent() {
  const { t } = useTranslation();

  return <Text>{t("hello")}</Text>;
}
```

It's a recommended way to translate your app.

### Store presence

If you plan on shipping your app to different countries or regions or want it to support various languages, you can provide localized strings for things like the display name and system dialogs.

To do so, check the [official Expo documentation](https://docs.expo.dev/guides/localization/) as it requires modifying your app configuration (`app.config.ts`).

You can find the resources below helpful in this process:

<Cards>
  <Card title="Expo Localization" href="https://docs.expo.dev/guides/localization/" description="docs.expo.dev" />

  <Card title="Apple App Store Localization" href="https://developer.apple.com/localization/" description="developer.apple.com" />

  <Card title="Google Play Localization" href="https://support.google.com/googleplay/android-developer/answer/9844778?hl=en" description="support.google.com" />
</Cards>

## Language switcher

TurboStarter ships with a language customizer component that allows you to switch between languages. You can import and use the `LocaleCustomizer` component and drop it anywhere in your application to allow users to change the language seamlessly.

```tsx
import { LocaleCustomizer } from "@turbostarter/ui-mobile/i18n";

export default function MyComponent() {
  return <LocaleCustomizer />;
}
```

The component automatically displays all languages configured in your i18n settings. When a user switches languages, it will be reflected in the app and saved into persistent storage to keep the language across app restarts.

## Best practices

Here are key best practices for managing translations in your mobile app:

* Use clear, hierarchical translation keys for easy maintenance

  ```ts
  // ✅ Good
  "screen.home.welcome";
  "component.button.submit";

  // ❌ Bad
  "welcomeText";
  ```

* Organize translations by app screens and features

  ```
  translations/
  ├── en/
  │   ├── layout.json
  │   └── common.json
  └── es/
      ├── layout.json
      └── common.json
  ```

* Consider device language settings and regional formats

* Cache translations locally for offline access

* Handle dynamic content for mobile contexts:

  ```ts
  // Device-specific messages
  t("errors.noConnection"); // "Check your internet connection"

  // Dynamic values
  t("storage.space", { gb: 2.5 }); // "2.5 GB available"
  ```

* Keep translations concise - mobile screens have limited space

* Test translations with different screen sizes and orientations
