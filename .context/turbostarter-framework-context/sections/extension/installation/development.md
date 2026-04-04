---
title: Development
description: Get started with the code and develop your browser extension.
url: /docs/extension/installation/development
---

# Development

## Prerequisites

To get started with TurboStarter, ensure you have the following installed and set up:

* [Node.js](https://nodejs.org/en) (22.x or higher)
* [Docker](https://www.docker.com) (only if you want to use local services e.g. database)
* [pnpm](https://pnpm.io)

## Project development

<Steps>
  <Step>
    ### Install dependencies

    Install the project dependencies by running the following command:

    ```bash
    pnpm i
    ```

    <Callout title="Why pnpm?">
      It is a fast, disk space efficient package manager that uses hard links and symlinks to save one version of a module only ever once on a disk. It also has a great [monorepo support](https://pnpm.io/workspaces). Of course, you can change it to use [Bun](https://bunpkg.com), [yarn](https://yarnpkg.com) or [npm](https://www.npmjs.com) with minimal effort.
    </Callout>
  </Step>

  <Step>
    ### Setup environment variables

    Create a `.env.local` files from `.env.example` files and fill in the required environment variables.

    You can use the following command to recursively copy the `.env.example` files to the `.env.local` files:

    <Tabs items={["Unix (MacOS/Linux)", "Windows"]}>
      <Tab value="Unix (MacOS/Linux)">
        ```bash
        find . -name ".env.example" -exec sh -c 'cp "$1" "${1%.example}.local"' _ {} \;
        ```
      </Tab>

      <Tab value="Windows">
        ```bash
        Get-ChildItem -Recurse -Filter ".env.example" | ForEach-Object {
            Copy-Item $_.FullName ($\_.FullName -replace '\.example$', '.local')
        }
        ```
      </Tab>
    </Tabs>

    Check [Environment variables](/docs/extension/configuration/environment-variables) for more details on setting up environment variables.
  </Step>

  <Step>
    ### Setup services

    If you want to use local services like database etc. (**recommended for development purposes**), ensure Docker is running, then setup them with:

    ```bash
    pnpm services:setup
    ```

    This command initiates the containers and runs necessary setup steps, ensuring your services are up to date and ready to use.
  </Step>

  <Step>
    ### Start development server

    To start the application development server, run:

    ```bash
    pnpm dev
    ```

    Your development server should now be running 🎉

    WXT will create a dev bundle for your extension and start a live-reloading development server, which will automatically update your extension bundle and reload your browser on source code changes.

    It also makes the icon grayscale to distinguish between development and production extension bundles.
  </Step>

  <Step>
    ### Load the extension

    <Tabs items={["Chrome", "Firefox"]}>
      <Tab value="Chrome">
        Head over to `chrome://extensions` and enable **Developer Mode**.

        ![Developer mode](/images/docs/extension/chrome/developer-mode.png)

        Click on "Load Unpacked" and navigate to your extension's `apps/extension/build/chrome-mv3` directory.

        To see your popup, click on the puzzle piece icon on the Chrome toolbar, and click on your extension.

        ![Pin to toolbar](/images/docs/extension/chrome/pin.png)

        <Callout title="Pro tip">
          Pin your extension to the Chrome toolbar for easy access by clicking the pin button.
        </Callout>
      </Tab>

      <Tab value="Firefox">
        Head over to `about:debugging` and click on "This Firefox".

        Click on "Load Temporary Add-on" and navigate to your extension's `apps/extension/build/firefox-mv2` directory. Pick any file to load the extension.

        ![Load temporary add-on](/images/docs/extension/firefox/load.png)

        The extension now installs, and remains installed until you restart Firefox.

        To see your popup, click on your extension icon on the Firefox toolbar.

        ![Popup](/images/docs/extension/firefox/popup.png)

        <Callout>
          Loaded extension starts as pinned on the Firefox toolbar. Don't remove it to easily access it later.
        </Callout>
      </Tab>
    </Tabs>

    <Callout title="Automatic browser startup">
      You can also configure your development server to automatically start the browser when you start the server. To do it, create a `web-ext.config.ts` file in a root of your extension and configure it with your browser [binaries](https://wxt.dev/guide/essentials/config/browser-startup.html#set-browser-binaries) and [argumens](https://wxt.dev/guide/essentials/config/browser-startup.html#persist-data).

      Learn more in the [official documentation](https://wxt.dev/guide/essentials/config/browser-startup.html).
    </Callout>
  </Step>

  <Step>
    ### Publish to stores

    When you're ready to publish the project to the stores, follow the [guidelines](/docs/extension/marketing) and [checklist](/docs/extension/publishing/checklist) to ensure everything is set up correctly.
  </Step>
</Steps>
