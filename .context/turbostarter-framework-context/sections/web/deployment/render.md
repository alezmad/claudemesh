---
title: Render
description: Learn how to deploy your TurboStarter app to Render.
url: /docs/web/deployment/render
---

# Render

[Render](https://render.com) offers a unique combination of features that make it an ideal platform for deploying modern web applications. With Render, you can leverage continuous deployment, managed databases, and a global CDN to ensure your application is not only fast and reliable but also scalable and secure.

In this guide, we will walk through the steps to deploy your TurboStarter app to Render, highlighting the benefits of using Render's platform. You will learn how to connect your repository, configure build settings, and manage environment variables to ensure a seamless and efficient deployment process that takes advantage of Render's features.

<Callout type="warn" title="Prerequisite: Render account">
  To deploy to Render, you need to have an account. You can create one [here](https://dashboard.render.com/register).
</Callout>

<Steps>
  <Step>
    ## Create a new service

    Navigate to the [Render dashboard](https://dashboard.render.com) and click on the *New* button.

    ![Create new service](/images/docs/web/deployment/render/create-service.png)

    Pick the *Web Service* option and proceed to the next step.
  </Step>

  <Step>
    ## Connect your repository

    Choose the Git provider of your project and select the repository you want to deploy.

    ![Connect repository](/images/docs/web/deployment/render/connect-repository.png)

    <Callout title="Authorization needed">
      If your repository is private you need to authorize Render to access it. It's recommended to follow a *least privileged access* approach, so to only grant access to the repository you want to deploy, not the entire account.
    </Callout>
  </Step>

  <Step>
    ## Configure service settings

    Finalize your deployment by configuring the build settings to match your project's specific needs. Refer to the screenshots below to ensure a seamless deployment process.

    ![Render service settings](/images/docs/web/deployment/render/general-settings.png)

    You can also group your service with other services (e.g. [databases](https://render.com/docs/postgresql-creating-connecting) or [cron jobs](https://render.com/docs/cronjobs)) in a [Project](https://render.com/docs/projects), which will help you manage them together.

    [Read official documentation for more information](https://render.com/docs/projects).

    <Callout title="Customize region for better performance">
      If you want to achieve better performance and lower latency in your API requests, you can customize the region of your Render service. Make sure to set it to the region closest to your database and users.
    </Callout>

    ### Commands

    Configure the build and start commands to ensure that your project is built and started correctly.

    ![Render service commands](/images/docs/web/deployment/render/commands.png)

    Make sure to set them to the following values:

    * **Build command** - `pnpm install --frozen-lockfile; pnpm dlx turbo build --filter=web`
    * **Start command** - `pnpm --filter=web start`

    ### Instance type

    Select a plan that fits your project's needs.

    ![Render instance type](/images/docs/web/deployment/render/instance-type.png)

    For testing purposes or MVPs, you can safely use the *Free* plan. Although, for the production version, it's recommended to upgrade your plan, as it offers more resources and your project won't be paused after periods of inactivity.

    ### Environment variables

    Last, but not least, you need to set the environment variables for your project. Make sure to check if all the required variables are set.

    ![Render environment variables](/images/docs/web/deployment/render/environment-variables.png)

    You can also modify *Advanced settings* to set e.g. [health checks](https://render.com/docs/deploys#health-checks) or modify [auto deploy](https://render.com/docs/deploys#automatic-git-deploys) triggers.
  </Step>

  <Step>
    ## Deploy!

    Click on the *Deploy Web Service* button to start the deployment process.

    ![Render deploy](/images/docs/web/deployment/render/deploy.png)

    That's it! Your app is now deployed to Render, congratulations! 🎉
  </Step>
</Steps>

Render is a powerful platform with a lot of integrations and features. Feel free to check out the [official documentation](https://render.com/docs) for more information.
