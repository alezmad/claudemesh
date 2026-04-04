---
title: Development
description: Get started with the code and develop your mobile SaaS.
url: /docs/mobile/installation/development
---

# Development

## Prerequisites

To get started with TurboStarter, ensure you have the following installed and set up:

* [Node.js](https://nodejs.org/en) (22.x or higher)
* [Docker](https://www.docker.com) (only if you want to use local services e.g. database)
* [pnpm](https://pnpm.io)
* [Firebase](https://firebase.google.com) project (optional for some features - check [Firebase project](/docs/mobile/installation/firebase) section for more details)

## Project development

<Steps>
  <Step>
    ### Set up environment

    We won't copy the official docs, as there is quite a bit of setup you need to make to get started with iOS and Android development and it also depends what approach you want to take.

    [Check this official setup guide to get started](https://docs.expo.dev/get-started/set-up-your-environment/). After you're done with the setup, go back to this guide and continue with the next step.

    You can pick if you want to develop the app for iOS or Android by using the real device or the simulator.

    <Callout title="Recommendation">
      We recommend using the simulators and [development builds](https://docs.expo.dev/develop/development-builds/create-a-build/) for development, as it is more real and reliable approach. It also won't limit you in terms of native dependencies (required for e.g. [analytics](/docs/mobile/analytics/overview)).

      Of course, you can start with the simplest approach (using [Expo Go](https://expo.dev/go)) and when you iterate further, switch to different approach.
    </Callout>
  </Step>

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

    Check [Environment variables](/docs/web/configuration/environment-variables) for more details on setting up environment variables.
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

    Your development server should now be running at `http://localhost:8081`.

    ![Metro server](/images/docs/mobile/metro-server.png)

    Scan the QR code with your mobile device to start the app or press the appropriate key on your keyboard to run it on simulator. In case of any issues check the [Troubleshooting](https://docs.expo.dev/troubleshooting/overview/) section.
  </Step>

  <Step>
    ### Publish to stores

    When you're ready to publish the project to the stores, follow [guidelines](/docs/mobile/marketing) and [checklist](/docs/mobile/publishing/checklist) to ensure everything is set up correctly.
  </Step>
</Steps>
