---
title: Internationalization
description: Learn how to internationalize your extension.
url: /docs/extension/internationalization
---

# Internationalization

Turbostarter's extension uses [i18next](https://www.i18next.com/) and web cookies to store the language preference of the user. This allows the extension to be fully internationalized.

<Callout title="Why this combination?">
  We use i18next because it's a robust and widely-adopted internationalization framework that works seamlessly with React.

  The combination with web cookies allows us to persistently store language preferences across all extension contexts and share it with the web app while maintaining excellent performance and browser compatibility.
</Callout>

![i18next logo](/images/docs/i18next.jpg)

## Configuration

The global configuration is defined in the `@turbostarter/i18n` package and shared across all applications. You can read more about it in the [web configuration](/docs/web/internationalization/configuration) documentation.

By default, the locale is automatically detected based on the user's device settings. You can override it and set the default locale of your mobile app in the [app configuration](/docs/extension/configuration/app) file.

Also, the locale configuration is **shared between the web app and the extension** (same as [session](/docs/extension/auth/session)), which means that changing the locale in one place will automatically update it in the other. It's a common pattern for modern apps, simplifying the user experience and reducing the maintenance effort.

### Cookies

When a user first opens the [web app](/docs/web), the locale is detected and a cookie is set. This cookie is used to remember the user's language preference.

You can find its value in the *Cookies* tab of the developer tools of your browser:

![Locale cookie](/images/docs/extension/locale-cookie.png)

To enable your extension to read the cookie and that way share the locale settings with the web app, you need to set the cookies permission in the `wxt.config.ts` under `manifest.permissions` field:

```ts
export default defineConfig({
  manifest: {
    permissions: ["cookies"],
  },
});
```

And to be able to read the cookie from your app url, you need to set host\_permissions, which will include your app url:

```ts
export default defineConfig({
  manifest: {
    host_permissions: ["http://localhost/*", "https://your-app-url.com/*"],
  },
});
```

Then you would be able to share the cookie between your apps and also read its value using `browser.cookies` API.

<Callout title="Avoid &#x22;<all_urls>&#x22;" type="warn">
  Avoid using `<all_urls>` in `host_permissions`. It affects all urls and may cause security issues, as well as a [rejection](https://developer.chrome.com/docs/webstore/review-process#review-time-factors) from the destination store.
</Callout>

<Cards>
  <Card title="Declare permissions" href="https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions" description="developer.chrome.com" />

  <Card title="chrome.cookies" href="https://developer.chrome.com/docs/extensions/reference/api/cookies" description="developer.chrome.com" />
</Cards>

## Translating extension

To translate individual components and screens, you can use the well-known `useTranslation` hook.

```tsx
import { useTranslation } from "@turbostarter/i18n";

export const Popup = () => {
  const { t } = useTranslation();

  return <div>{t("hello")}</div>;
};
```

That's the recommended way to translate stuff inside your extension.

### Store presence

As we saw in the [manifest](/docs/extension/configuration/manifest#locales) section, you can also localize your extension's store presence (like title, description, and other metadata). This allows you to customize how your extension appears in different web stores based on the user's language.

Each store has specific requirements for localization:

* [Chrome Web Store](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/) requires a `_locales` directory with JSON files for each language
* [Firefox Add-ons](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization) uses a similar structure but with some differences in the manifest
* [Edge Add-ons](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#supporting-multiple-languages) uses the same structure as Chrome Web Store

Although most of the config is abstracted behind common structure, please follow the store-specific guides below for detailed instructions on setting up localization for your extension's store listing.

<Cards>
  <Card title="I18n - WXT" href="https://wxt.dev/guide/essentials/i18n.html" description="wxt.dev" />

  <Card title="Chrome Web Store" href="https://developer.chrome.com/docs/webstore/cws-dashboard-listing" description="developer.chrome.com" />

  <Card title="Firefox Add-ons" href="https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization" description="developer.mozilla.org" />

  <Card title="Edge Add-ons" href="https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#supporting-multiple-languages" description="developer.microsoft.com" />
</Cards>

## Language switcher

TurboStarter ships with a language customizer component that allows users to switch between languages in your extension. You can import and use the `LocaleCustomizer` component in your popup, options page, or any other extension view:

```tsx
import { LocaleCustomizer } from "@turbostarter/ui-web/i18n";

export const Popup = () => {
  return <LocaleCustomizer />;
};
```

<Callout title="This will change the locale of the web app as well" type="warn">
  As the web app and extension share the same i18n configuration (cookie), changing the language in one will affect the other. **This is intentional** and ensures a consistent experience across both platforms, since your extension likely serves as a companion to the web app and should maintain the same language preferences.
</Callout>

## Best practices

Here are key best practices for managing translations in your browser extension:

* Use descriptive, hierarchical translation keys

  ```ts
  // ✅ Good
  "popup.settings.language";
  "content.toolbar.save";

  // ❌ Bad
  "saveButton";
  "text1";
  ```

* Organize translations by extension views and features

  ```
  _locales/
  ├── en/
  │   ├── messages.json
  │   ├── popup.json
  │   └── options.json
  └── es/
      ├── messages.json
      ├── popup.json
      └── options.json
  ```

* Handle fallback languages gracefully

* Keep manifest descriptions localized for store listings

* Consider context in translations:

  ```ts
  // Context-aware messages
  t("button.save", { context: "document" }); // "Save document"
  t("button.save", { context: "settings" }); // "Apply changes"
  ```

* Use placeholders for dynamic content:

  ```ts
  // With variables
  t("status.saved", { time: "2 minutes ago" }); // "Last saved 2 minutes ago"

  // With plurals
  t("items", { count: 5 }); // "5 items"
  ```

* Keep translations in sync between extension views

* Cache translations for offline functionality
