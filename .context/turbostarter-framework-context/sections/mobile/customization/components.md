---
title: Components
description: Manage and customize your app components.
url: /docs/mobile/customization/components
---

# Components

For the components part, we're using [react-native-reusables](https://reactnativereusables.com//getting-started/introduction/) for atomic, accessible and highly customizable components.

> It's like shadcn/ui, but for mobile apps.

<Callout type="info" title="Why react-native-reusables?">
  react-native-reusables is a powerful tool that allows you to generate
  pre-designed components with a single command. It's built with Uniwind (like
  Tailwind CSS for mobile) and accessibility in mind, it's also highly
  customizable.
</Callout>

TurboStarter defines two packages that are responsible for the UI part of your app:

* `@turbostarter/ui` - shared styles, [themes](/docs/mobile/customization/styling#themes) and assets (e.g. icons)
* `@turbostarter/ui-mobile` - pre-built UI mobile components, ready to use in your app

## Adding a new component

There are basically two ways to add a new component:

<Tabs items={["Using the CLI", "Copy-pasting"]}>
  <Tab value="Using the CLI">
    TurboStarter is fully compatible with [react-native-reusables CLI](https://www.npmjs.com/package/@react-native-reusables/cli), so you can generate new components with single command.

    Run the following command from the **root** of your project:

    ```bash
    pnpm --filter @turbostarter/ui-mobile ui:add
    ```

    This will launch an interactive command-line interface to guide you through the process of adding a new component where you can pick which component you want to add.

    ```bash
    Which components would you like to add? > Space to select. A to toggle all.
    Enter to submit.

    ◯  accordion
    ◯  alert
    ◯  alert-dialog
    ◯  aspect-ratio
    ◯  avatar
    ◯  badge
    ◯  button
    ◯  calendar
    ◯  card
    ◯  checkbox
    ```

    Newly created components will appear in the `packages/ui/mobile/src` directory.
  </Tab>

  <Tab value="Copy-pasting">
    You can always copy-paste a component from the [react-native-reusables](https://reactnativereusables.com//getting-started/introduction/) website and modify it to your needs.

    This is possible, because the components are headless and don't need (in most cases) any additional dependencies.

    Copy code from the website, create a new file in the `packages/ui/mobile/src` directory and paste the code into the file.
  </Tab>
</Tabs>

<Callout title="Keep it atomic" type="warn">
  Keep in mind that you should always try to keep shared components as atomic as possible. This will make it easier to reuse them and to build specific views by composition.

  E.g. include components like `Button`, `Input`, `Card`, `Dialog` in shared package, but keep specific components like `LoginForm` in your app directory.
</Callout>

## Using components

Each component is a standalone entity which has a separate export from the package. It helps to keep things modular, avoid unnecessary dependencies and make tree-shaking possible.

To import a component from the UI package, use the following syntax:

```tsx title="apps/mobile/src/modules/common/my-component.tsx"
// [!code word:card]
import {
  Card,
  CardContent,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
} from "@turbostarter/ui-mobile/card";
```

Then you can use it to build a component specific to your app:

```tsx title="apps/mobile/src/modules/common/my-component.tsx"
export function MyComponent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Component</CardTitle>
      </CardHeader>
      <CardContent>
        <Text>My Component Content</Text>
      </CardContent>
      <CardFooter>
        <Button>Click me</Button>
      </CardFooter>
    </Card>
  );
}
```

<Callout title="Think of it the same as for the web">
  Most of the components are the same as for the [web app](/docs/web/customization/components).

  It means that you can basically migrate existing web components to the mobile app with just an import change!
</Callout>

<Card href="https://reactnativereusables.com//getting-started/introduction/" title="react-native-reusables" description="reactnativereusables.com" />
