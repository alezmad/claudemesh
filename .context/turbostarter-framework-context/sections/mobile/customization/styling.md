---
title: Styling
description: Get started with styling your app.
url: /docs/mobile/customization/styling
---

# Styling

To build the mobile user interface, TurboStarter comes with [Uniwind](https://uniwind.dev/) pre-configured.

<Callout title="Why Uniwind?" type="info">
  Uniwind brings Tailwind CSS utilities to React Native. It lets you style with familiar classes while keeping native performance and platform-appropriate primitives.
</Callout>

## Tailwind configuration

In the `packages/ui/shared/src/styles` directory, you will find shared CSS files with Tailwind configuration. To change global styles, edit the files in this folder.

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

Also, each app has its own `globals.css` file, which extends the shared config and allows you to override global styles.

Here is an example of an app's `globals.css` file:

```css title="apps/mobile/src/assets/styles/globals.css"
@import "@turbostarter/ui/globals.css";
@import "uniwind";

@theme inline {
  --font-sans: "Geist_400Regular";
  --font-sans-medium: "Geist_500Medium";
  --font-sans-semibold: "Geist_600SemiBold";
  --font-sans-bold: "Geist_700Bold";
  --font-mono: "GeistMono_400Regular";
}
```

This keeps a clear separation of concerns and a consistent structure for the Tailwind CSS configuration across apps.

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

These variables are consumed across platforms. On mobile, the theme provider injects the shared variables into the app, so Uniwind utility classes like `bg-background` and `text-foreground` resolve correctly.

Feel free to add your own themes or override the existing ones to match your brand's identity.

To apply a custom theme to your app, use a `useTheme` hook to modify the config:

```tsx title="apps/mobile/src/lib/providers/theme.tsx"
import { ThemeColor, ThemeMode } from "@turbostarter/ui";

import { useTheme } from "~/modules/common/hooks/use-theme";

export const ThemeSwitcher = () => {
  const { setConfig } = useTheme();

  return (
    <Pressable
      onPress={() =>
        setConfig({ mode: ThemeMode.DARK, color: ThemeColor.BLUE })
      }
    >
      <Text>Change the theme to dark blue</Text>
    </Pressable>
  );
};
```

Under the hood, the `useTheme` hook uses [Uniwind.setTheme](https://docs.uniwind.dev/theming/basics#switch-to-a-specific-theme) and [updateCSSVariables](https://docs.uniwind.dev/theming/update-css-variables) utilities to apply the correct theme to the app together with its variables.

## Dark mode

TurboStarter comes with built-in dark mode support.

Each theme has a corresponding set of dark mode variables, which are used to switch the theme to its dark mode counterpart.

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

Our custom implementation reads the system color scheme via `useColorScheme` and applies `dark:` variants automatically. With the provider injecting shared variables, dark mode works out of the box.

You can also define the default theme mode and color in the [app configuration](/docs/mobile/configuration/app).

<Cards>
  <Card title="Uniwind" description="uniwind.dev" href="https://uniwind.dev/" />

  <Card title="Theming Basics | Uniwind" description="docs.uniwind.dev" href="https://docs.uniwind.dev/theming/basics" />

  <Card title="Custom Themes | Uniwind" description="docs.uniwind.dev" href="https://docs.uniwind.dev/theming/custom-themes" />
</Cards>
