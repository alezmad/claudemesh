---
title: Standalone API
description: Learn how to deploy your API as a dedicated service.
url: /docs/web/deployment/api
---

# Standalone API

Sometimes you want to deploy your API as a standalone service. This is useful if you want to deploy your API to a different domain or to deploy it as a microservice. You can also follow this approach if you don't need a web app, but still need API service for [mobile app](/docs/mobile) or [browser extension](/docs/extension).

Deploying your API as a standalone service provides enhanced flexibility and scalability. This allows you to independently scale your API from your web app. It's particularly beneficial for executing "long-running" tasks on your backend, such as report generation, real-time data processing, or background tasks that are likely to timeout in a serverless environment.

This guide explains how to deploy your TurboStarter API as a standalone service. As Hono has multiple deployment options (e.g. [Deno](https://hono.dev/docs/getting-started/deno), [Bun](https://hono.dev/docs/getting-started/bun)), this guide will focus primarily on the [Node.js](https://hono.dev/docs/getting-started/nodejs) deployment.

<Steps>
  <Step>
    ## Create separate API app

    We have a [dedicated guide](/docs/web/customization/add-app) on how to add another app to your project. However, in this case, only a few files need to be added, so we can do it quickly here.

    First, let's create an `api` directory inside the `apps` directory - it will be the root of your API app.

    Next, add the following files into the `apps/api` directory:

    <Tabs items={["package.json", "tsconfig.json", "src/index.ts"]}>
      <Tab value="package.json">
        ```json
        {
          "name": "api",
          "version": "0.1.0",
          "private": true,
          "scripts": {
            "build": "esbuild ./src/index.ts --bundle --platform=node --outfile=dist/index.js",
            "clean": "git clean -xdf dist .turbo node_modules",
            "dev": "dotenv -c -- tsx watch src/index.ts",
            "start": "node dist/index.js",
            "typecheck": "tsc --noEmit"
          },
          "dependencies": {
            "@hono/node-server": "1.13.7",
            "@turbostarter/api": "workspace:*"
          },
          "devDependencies": {
            "@turbostarter/tsconfig": "workspace:*",
            "@types/node": "20.16.10",
            "esbuild": "0.24.2",
            "tsx": "4.19.2",
            "typescript": "catalog:"
          }
        }
        ```
      </Tab>

      <Tab value="tsconfig.json">
        ```json
        {
          "extends": "@turbostarter/tsconfig/base.json",
          "include": ["src"],
          "exclude": ["node_modules"]
        }
        ```
      </Tab>

      <Tab value="src/index.ts">
        ```ts
        import { serve } from "@hono/node-server";
        import { appRouter } from "@turbostarter/api";

        serve(
          {
            fetch: appRouter.fetch,
            port: Number(process.env.PORT) || 3001,
          },
          ({ port }) => {
            console.log(`Server is running on ${port} 🚀`);
          },
        );
        ```
      </Tab>
    </Tabs>

    This will enable you to have a minimal configuration required to run your API as a standalone service. For sure, you can add more configuration (e.g. ESLint or Prettier) if needed, we just want to keep it minimal for the sake of this guide.
  </Step>

  <Step>
    ## Connect web app to API

    The API will be running on a different URL than your web app. For the minimal setup and to avoid handling [cross-origin resource sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) issues, we will rewrite the API URL in the web app.

    To do this, you will need to change your `next.config.ts` file to include the API URL rewrite:

    ```js title="apps/web/next.config.ts"
    import type { NextConfig } from "next";

    const config: NextConfig = {
      rewrites: async () => [
        {
          source: "/api/:path*",
          destination: `${env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/:path*`,
        },
      ],
    };
    ```

    <Callout title="Use environment variable to set API url">
      It's recommended to use an environment variable (e.g. `NEXT_PUBLIC_API_URL`) to set the API URL. This is a good practice to make it easier to change the API URL in different environments (e.g. development, staging, production).
    </Callout>

    Now you should be able to run your API as a standalone service. When you run the project with `pnpm dev`, you will see the new app called `api` with your API server running on [http://localhost:3001](http://localhost:3001).
  </Step>

  <Step>
    ## Deploy!

    You can basically deploy your API as any other Node.js project. We will quickly go through the two most popular options: [PaaS](https://en.wikipedia.org/wiki/Platform_as_a_service) and [Docker](https://www.docker.com/).

    ### Platform as a Service (PaaS)

    PaaS providers like [Vercel](https://vercel.com/), [Heroku](https://www.heroku.com/), or [Netlify](https://www.netlify.com/) allow you to deploy your Node.js app with a few clicks. You can follow our [dedicated guides](/docs/web/deployment/checklist#deploy-web-app-to-production) for the most popular providers. Every process is similar, and will contains a few crucial steps:

    1. Connecting your repository to the PaaS provider
    2. Setting up build settings (e.g. build command, output directory)
    3. Setting up environment variables
    4. Deploying the project

    <Callout title="Ensure correct commands">
      To make sure your API is built and run correctly, you will need to ensure that appropriate commands are correctly set up. In our case, the following commands will need to be configured:

      <Tabs items={["Build command", "Start command"]}>
        <Tab value="Build command">
          ```bash
          pnpm turbo build --filter=api
          ```
        </Tab>

        <Tab value="Start command">
          ```bash
          pnpm --filter=api start
          ```
        </Tab>
      </Tabs>

      This is required to ensure that the PaaS provider of your choice will be able to build and run your application correctly.
    </Callout>

    ### Docker

    Deploying your API as a Docker container is a good option if you want to have more control over the deployment process. You can follow our [dedicated guide](/docs/web/deployment/docker) to learn how to deploy your API as a Docker container.

    For the API application, the `Dockerfile` will be located in the `apps/api` directory and it could look like this:

    ```dockerfile title="apps/api/Dockerfile"
    FROM node:20-alpine AS base
    ENV PNPM_HOME="/pnpm"
    ENV PATH="$PNPM_HOME:$PATH"
    RUN corepack enable

    FROM base AS pruner
    WORKDIR /app
    RUN apk add --no-cache libc6-compat
    COPY . .
    RUN pnpm dlx turbo prune api --docker

    FROM base AS builder
    WORKDIR /app
    RUN apk add --no-cache libc6-compat
    COPY --from=pruner /app/out/json/ .
    COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
    RUN pnpm install --frozen-lockfile --ignore-scripts --prefer-offline && pnpm store prune
    ENV SKIP_ENV_VALIDATION=1 \
        NODE_ENV=production
    COPY --from=pruner /app/out/full/ .
    RUN pnpm dlx turbo build --filter=api

    FROM base AS runner
    WORKDIR /app
    RUN addgroup -g 1001 -S nodejs && \
        adduser -S api -u 1001 -G nodejs
    COPY --from=builder --chown=api:nodejs /app/apps/api/dist/ ./
    USER api
    EXPOSE 3001
    CMD ["node", "index.js"]
    ```

    To test if everything works correctly, you can run a [container](https://docs.docker.com/get-started/03_run_your_app/) locally with the following commands:

    ```bash
    docker build -f ./apps/api/Dockerfile . -t turbostarter-api
    docker run -p 3001:3001 turbostarter-api
    ```

    Make sure to also [pass](https://docs.docker.com/reference/cli/docker/container/run/#env) all the required environment variables to the container, so your API can start without any issues.

    Deploying your API as a Docker container is a great way to isolate your API from the host environment, making it easier to deploy and scale. It also simplifies the workflow if you're working with a team, as you can easily share the Docker image with your colleagues and they will run the API in the **exact same** environment.
  </Step>
</Steps>

That's it! You can now grow your API layer as a standalone service, separated from other apps in your project, and deploy it anywhere you want.
