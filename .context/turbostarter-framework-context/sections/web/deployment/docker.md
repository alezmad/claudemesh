---
title: Docker
description: Learn how to containerize your TurboStarter app with Docker.
url: /docs/web/deployment/docker
---

# Docker

[Docker](https://docker.com) is a popular platform for containerizing applications, making it easy to package your app with all its dependencies for consistent performance across environments. It simplifies development, testing, and deployment.

This guide explains how to containerize your TurboStarter app using Docker. You'll learn to create a Dockerfile, build a container image, and run your app in a container for a reliable and portable setup.

<Steps>
  <Step>
    ## Configure Next.js for Docker

    First of all, we need to configure Next.js to output the build files in the [standalone format](https://nextjs.org/docs/pages/api-reference/config/next-config-js/output) - it's required for the Docker image to work. To do this, we need to add the following to our `next.config.ts` file:

    ```js title="apps/web/next.config.ts"
    import type { NextConfig } from "next";

    const config: NextConfig = {
      output: "standalone",

      ...
    };
    ```
  </Step>

  <Step>
    ## Create a Dockerfile

    [Dockerfile](https://docs.docker.com/get-started/02_our_app/) is a text file that contains the instructions for building a [Docker image](https://docs.docker.com/get-started/02_our_app/). It defines the environment, dependencies, and commands needed to run your app. You can safely copy the following Dockerfile to your project:

    ```dockerfile title="apps/web/Dockerfile"
    FROM node:22-alpine AS base
    ENV PNPM_HOME="/pnpm"
    ENV PATH="$PNPM_HOME:$PATH"
    RUN corepack enable

    FROM base AS pruner
    WORKDIR /app
    RUN apk add --no-cache libc6-compat
    COPY . .
    RUN pnpm dlx turbo prune web --docker

    FROM base AS builder
    WORKDIR /app
    RUN apk add --no-cache libc6-compat
    COPY --from=pruner /app/out/json/ .
    COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
    RUN pnpm install --frozen-lockfile --ignore-scripts --prefer-offline && pnpm store prune
    ENV SKIP_ENV_VALIDATION=1 \
        NODE_ENV=production
    COPY --from=pruner /app/out/full/ .
    RUN pnpm dlx turbo build --filter=web

    FROM base AS runner
    WORKDIR /app
    RUN addgroup -g 1001 -S nodejs && \
        adduser -S web -u 1001 -G nodejs
    COPY --from=builder --chown=web:nodejs /app/apps/web/.next/standalone ./
    COPY --from=builder --chown=web:nodejs /app/apps/web/.next/static ./apps/web/.next/static
    COPY --from=builder --chown=web:nodejs /app/apps/web/public ./apps/web/public
    USER web
    EXPOSE 3000
    CMD ["node", "apps/web/server.js"]
    ```

    Feel free to check out our [self-hosting guide](/blog/self-host-your-nextjs-turborepo-app-with-docker-in-5-minutes) for more details on how each stage of the Dockerfile works.

    And that's all we need! You can now build and run your Docker image to deploy your app anywhere you want in an [isolated environment](https://docs.docker.com/get-started/workshop/04_sharing_app/).
  </Step>

  <Step>
    ## Run a container

    To test if everything works correctly, you can run a [container](https://www.docker.com/resources/what-container/) locally with the following commands:

    ```bash
    docker build -f ./apps/web/Dockerfile . -t turbostarter
    docker run -p 3000:3000 turbostarter
    ```

    Make sure to also [pass](https://docs.docker.com/reference/cli/docker/container/run/#env) all the required environment variables to the container, so your app can start without any issues.

    If everything works correctly, you should be able to access your app at [http://localhost:3000](http://localhost:3000).
  </Step>
</Steps>

That's it! You can now build and deploy your app as a Docker container to any supported hosting (e.g. [Fly.io](/docs/web/deployment/fly)).

Using Docker containers is a great way to isolate your app from the host environment, making it easier to deploy and scale. It also simplifies the workflow if you're working with a team, as you can easily share the Docker image with your colleagues and they will run the app in the **exact same** environment.
