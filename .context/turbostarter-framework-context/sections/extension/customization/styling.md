---
title: Styling
description: Get started with styling your extension.
url: /docs/extension/customization/styling
---

# Styling

To build the extension interface TurboStarter comes with [Tailwind CSS](https://tailwindcss.com/) and [Radix UI](https://www.radix-ui.com/) pre-configured.

<Callout title="Why Tailwind CSS and Radix UI?" type="info">
  The combination of Tailwind CSS and Radix UI gives ready-to-use, accessible UI components that can be fully customized to match your brands design.
</Callout>

## Tailwind configuration

In the `packages/ui/shared/src/styles` directory, you will find shared CSS files with Tailwind CSS configuration. To change global styles, you can edit the files in this folder.

Here is an example of a shared CSS file that includes the Tailwind CSS configuration:

```css title="packages/ui/shared/src/styles/globals.css"
@import "tailwindcss";
@import "./themes.css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.65rem;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);

  ...
}
```

For colors, we rely strictly on [CSS Variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties) in [OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch) format to allow for easy theme management without the need for any JavaScript.

Also, each app has its own `globals.css` file, which extends the shared config and allows you to override the global styles.

Here is an example of an extension's `globals.css` file:

```css title="apps/extension/src/assets/styles/globals.css"
@import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&display=swap");
@import "@turbostarter/ui/globals.css";
@import "@turbostarter/ui-web/globals.css";

@theme {
  --font-sans: "Geist", sans-serif;
  --font-mono: "Geist Mono", monospace;
}
```

This way, we maintain a separation of concerns and a clear structure for the Tailwind CSS configuration.

## Themes

TurboStarter comes with **9+** predefined themes, which you can use to quickly change the look and feel of your app.

They're defined in the `packages/ui/shared/src/styles/themes` directory. Each theme is a set of variables that can be overridden:

```ts title="packages/ui/shared/src/styles/themes/colors/orange.ts"
export const orange = {
  light: {
    background: [1, 0, 0],
    foreground: [0.141, 0.005, 285.823],
    card: [1, 0, 0],
    "card-foreground": [0.141, 0.005, 285.823],
    ...
  }
} satisfies ThemeColors;
```

Each variable is stored as a [OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch) array, which is then converted to a CSS variable at build time (by our custom build script). That way we can ensure full type-safety and reuse themes across different parts of our apps (e.g. use the same theme in emails).

Feel free to add your own themes or override the existing ones to match your brand's identity.

To apply a theme to your app, you can use the `data-theme` attribute on your layout wrapper for each part of the extension:

```tsx title="modules/common/layout/layout.tsx"
import { StorageKey, useStorage } from "~/lib/storage";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { data } = useStorage(StorageKey.THEME);

  return (
    <div id="main" data-theme={data.color}>
      {children}
    </div>
  );
};
```

In TurboStarter, we're using [Storage API](/docs/extension/structure/storage) to persist the user's theme selection and then apply it to the `div#main` element.

## Dark mode

The starter kit comes with a built-in dark mode support.

Each theme has a corresponding dark mode variables which are used to change the theme to its dark mode counterpart.

```ts title="packages/ui/shared/src/styles/themes/colors/orange.ts"
export const orange = {
  light: {},
  dark: {
    background: [0.141, 0.005, 285.823],
    foreground: [0.985, 0, 0],
    card: [0.21, 0.006, 285.885],
    "card-foreground": [0.985, 0, 0],
    ...
  }
} satisfies ThemeColors;
```

Because the dark variant is defined to use a class (`@custom-variant dark (&:is(.dark *))`) in the shared Tailwind configuration, we need to add the `dark` class to the root element to apply dark mode styles.

The same as for the theme color, we're using here the [Storage API](/docs/extension/structure/storage) to persist the user's dark mode selection and then apply correct class name to the root `div` element:

```tsx title="modules/common/layout/layout.tsx"
import { StorageKey, useStorage } from "~/lib/storage";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { data } = useStorage(StorageKey.THEME);

  return (
    <div
      id="root"
      className={cn({
        dark:
          data.mode === THEME_MODE.DARK ||
          (data.mode === THEME_MODE.SYSTEM &&
            window.matchMedia("(prefers-color-scheme: dark)").matches),
      })}
    >
      {children}
    </div>
  );
};
```

You can also define the default theme mode and color in the [app configuration](/docs/extension/configuration/app).

<Cards>
  <Card title="Tailwind CSS" description="tailwindcss.com" href="https://tailwindcss.com/" />

  <Card title="Radix UI" description="radix-ui.com" href="https://www.radix-ui.com/" />
</Cards>
