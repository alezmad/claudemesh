---
title: Fly.io
description: Learn how to deploy your TurboStarter app to Fly.io.
url: /docs/web/deployment/fly
---

# Fly.io

[Fly.io](https://fly.io) makes deploying web applications to the cloud easy and efficient. It handles scaling, monitoring, and logging so you can focus on building your app.

This guide explains how to deploy your TurboStarter app on Fly.io. You'll learn how to leverage [Docker](/docs/web/deployment/docker) containers to deploy your app, set up builds, and manage environment variables for a smooth and reliable deployment.

<Callout type="warn" title="Prerequisite: Fly account and Docker configured">
  To deploy to Fly.io, you need to have an account. You can create one [here](https://fly.io/app/sign-up).

  You also need to have [Docker](/docs/web/deployment/docker) configured in your project.
</Callout>

<Steps>
  <Step>
    ## Setup Fly CLI

    As we will be using Fly CLI to launch and manage our app, you need to install and setup it on your machine.

    [Check the official documentation on how to install Fly CLI](https://fly.io/docs/flyctl/install/).

    After you've installed Fly CLI, you need to login to your Fly account and connect it with your machine:

    ```bash
    fly auth login
    ```

    [Read more about authenticating CLI](https://fly.io/docs/flyctl/auth/#available-commands).

    Now you're ready to launch your app!
  </Step>

  <Step>
    ## Launch project

    Use a [Dockerfile](/docs/web/deployment/docker) to launch your app with [Fly CLI](https://fly.io/docs/flyctl/). You can use the following command to do this from your local machine:

    ```bash
    fly launch --dockerfile apps/web/Dockerfile
    ```

    Make sure to set all the required configuration in the CLI steps (e.g. set port to `3000`, setup additional services, choose billing plan, etc.).

    ![Fly launch](/images/docs/web/deployment/fly/launch.png)

    <Callout title="Customize region for better performance">
      If you want to achieve better performance and lower latency in your API requests, you can customize the region of your Render service. Make sure to set it to the region closest to your database and users.
    </Callout>

    After the launch is complete, Fly will output your project configuration into `fly.toml` file. The configuration of your project is stored there, feel free to customize it to your needs:

    ```toml title="fly.toml"
    app = 'web-aged-sky-5596'
    primary_region = 'ams'

    [build]
      dockerfile = 'apps/web/Dockerfile'

    [http_service]
      internal_port = 3000
      force_https = true
      auto_stop_machines = 'stop'
      auto_start_machines = true
      min_machines_running = 0
      processes = ['app']

    [[vm]]
      memory = '512mb'
      cpu_kind = 'shared'
      cpus = 1
    ```

    See [Fly.io documentation](https://fly.io/docs/reference/configuration) for more information on how to use this file.
  </Step>

  <Step>
    ## Set up secrets

    To make your app fully functional, you need to set up required environment variables. You can do this by running the following command:

    ```bash
    fly secrets set --app <your-app-name> DATABASE_URL=...
    ```

    They will be automatically added to your app's runtime environment.
  </Step>

  <Step>
    ## Deploy!

    Each time you make changes to `fly.toml` or secrets, you need to re-deploy your app to apply changes to the running app.

    To do this, just run the following command in your project directory:

    ```bash
    fly deploy
    ```

    This will build your app and deploy it to Fly.io with the latest code version.

    ![Fly deploy](/images/docs/web/deployment/fly/deploy.png)

    That's it! Your app is now deployed to Fly.io, congratulations! 🎉
  </Step>
</Steps>

Fly is a platform that allows you to deploy and manage applications in the cloud. It provides a simple and intuitive way to deploy your app, with features such as automatic scaling, load balancing, and rolling updates. With Fly, you can focus on building your app without worrying about the underlying infrastructure.
