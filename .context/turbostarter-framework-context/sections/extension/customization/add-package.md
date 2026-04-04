---
title: Adding packages
description: Learn how to add packages to your Turborepo workspace.
url: /docs/extension/customization/add-package
---

# Adding packages

<Callout title="Advanced topic" type="warn">
  This is an **advanced topic** - you should only follow these instructions if you are sure you want to add a new package to your TurboStarter application instead of adding a folder to your application in `apps/web` or modify existing packages under `packages`. You don't need to do this to add a new page or component to your application.
</Callout>

To add a new package to your TurboStarter application, you need to follow these steps:

<Steps>
  <Step>
    ## Generate a new package

    First, enter the command below to create a new package in your TurboStarter application:

    ```bash
    turbo gen package
    ```

    Turborepo will ask you to enter the name of the package you want to create. Enter the name of the package you want to create and press enter.

    If you don't want to add dependencies to your package, you can skip this step by pressing enter.

    The command will have generated a new package under packages named `@turbostarter/<package-name>`. If you named it `example`, the package will be named `@turbostarter/example`.
  </Step>

  <Step>
    ## Export a module from your package

    By default, the package exports a single module using the `index.ts` file. You can add more exports by creating new files in the package directory and exporting them from the `index.ts` file or creating export files in the package directory and adding them to the `exports` field in the `package.json` file.

    ### From `index.ts` file

    The easiest way to export a module from a package is to create a new file in the package directory and export it from the `index.ts` file.

    ```ts title="packages/example/src/module.ts"
    export function example() {
      return "example";
    }
    ```

    Then, export the module from the `index.ts` file.

    ```ts title="packages/example/src/index.ts"
    export * from "./module";
    ```

    ### From `exports` field in `package.json`

    **This can be very useful for tree-shaking.** Assuming you have a file named `module.ts` in the package directory, you can export it by adding it to the `exports` field in the `package.json` file.

    ```json title="packages/example/package.json"
    {
      "exports": {
        ".": "./src/index.ts",
        "./module": "./src/module.ts"
      }
    }
    ```

    **When to do this?**

    1. when exporting two modules that don't share dependencies to ensure better tree-shaking. For example, if your exports contains both client and server modules.
    2. for better organization of your package

    For example, create two exports `client` and `server` in the package directory and add them to the `exports` field in the `package.json` file.

    ```json title="packages/example/package.json"
    {
      "exports": {
        ".": "./src/index.ts",
        "./client": "./src/client.ts",
        "./server": "./src/server.ts"
      }
    }
    ```

    1. The `client` module can be imported using `import { client } from '@turbostarter/example/client'`
    2. The `server` module can be imported using `import { server } from '@turbostarter/example/server'`
  </Step>

  <Step>
    ## Use the package in your extension

    You can now use the package in your extension by importing it using the package name:

    ```ts title="app/popup/index.tsx"
    import { example } from "@turbostarter/example";

    console.log(example());
    ```
  </Step>
</Steps>

Et voilà! You have successfully added a new package to your TurboStarter extension. 🎉
