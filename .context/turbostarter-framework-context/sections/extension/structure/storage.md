---
title: Storage
description: Learn how to store data in your extension.
url: /docs/extension/structure/storage
---

# Storage

TurboStarter leverages `wxt/storage` library to handle persistent storage for your extension. It's a utility library from that abstracts the persistent storage API available to browser extensions.

It falls back to localStorage when the extension storage API is unavailable, allowing for state sync between extension pages, content scripts, background service workers and web pages.

<Callout>
  To use the `wxt/storage` API, the "storage" permission **must** be added to the manifest:

  ```ts title="wxt.config.ts"
  export default defineConfig({
    manifest: {
      permissions: ["storage"],
    },
  });
  ```
</Callout>

## Storing data

The base Storage API is designed to be easy to use. It is usable in every extension runtime such as background service workers, content scripts and extension pages.

TurboStarter ships with predefined storage used to handle [theming](/docs/extension/customization/styling) in your extension, but you can create your own storage as well.

All storage-related methods and types are located in `lib/storage` directory.

```ts title="lib/storage/index.ts"
export const StorageKey = {
  THEME: "local:theme",
} as const;

export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];
```

Then, to make it available around your extension, we're setting it up and providing default values:

```ts title="lib/storage/index.ts"
import { storage as browserStorage } from "wxt/storage";

import { appConfig } from "~/config/app";

import type { ThemeConfig } from "@turbostarter/ui";

const storage = {
  [StorageKey.THEME]: browserStorage.defineItem<ThemeConfig>(StorageKey.THEME, {
    fallback: appConfig.theme,
  }),
} as const;
```

To learn more about customizing your storage, syncing state or setup automatic backups please refer to the [official documentation](https://wxt.dev/storage.html).

## Consuming storage

To consume storage in your extension, you can use the `useStorage` React hook that is automatically provided to every part of the extension. The hook API is designed to streamline the state-syncing workflow between the different pieces of an extension.

Here is an example on how to consume our theme storage in `Layout` component:

```tsx title="modules/common/layout/layout.tsx"
import { StorageKey, useStorage } from "~/lib/storage";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { data } = useStorage(StorageKey.THEME);

  return (
    <div id="root" data-theme={data.color}>
      {children}
    </div>
  );
};
```

Congrats! You've just learned how to persist and consume global data in your extension 🎉

For more advanced use cases, please refer to the [official documentation](https://wxt.dev/storage.html).

### Usage with Firefox

To use the storage API on Firefox during development you need to add an addon ID to your manifest, otherwise, you will get this error:

> Error: The storage API will not work with a temporary addon ID. Please add an explicit addon ID to your manifest. For more information see [https://mzl.la/3lPk1aE](https://mzl.la/3lPk1aE)

To add an addon ID to your manifest, add this to your package.json:

```ts title="wxt.config.ts"
export default defineConfig({
  manifest: {
    browser_specific_settings: {
      gecko: {
        id: "your-id@example.com",
      },
    },
  },
});
```

During development, you may use any ID. If you have published your extension, you need to use the ID assigned by [Firefox Add-ons](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons).

<Cards>
  <Card title="Storage API" href="https://wxt.dev/storage.html" description="wxt.dev" />

  <Card title="chrome.storage" href="https://developer.chrome.com/docs/extensions/reference/api/storage" description="developer.chrome.com" />
</Cards>
