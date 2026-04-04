---
title: Railway
description: Learn how to deploy your TurboStarter app to Railway.
url: /docs/web/deployment/railway
---

# Railway

[Railway](https://railway.app) is a platform that allows you to deploy your web applications to a cloud environment. It provides a simple and efficient way to manage your application's infrastructure, including scaling, monitoring, and logging.

This guide provides a step-by-step walkthrough for deploying your TurboStarter app on Railway, and taking advantage of its features in production environment. You'll discover how to link your repository, tailor build settings, and oversee environment variables, ensuring a smooth and optimized deployment process that leverages Railway's capabilities.

<Callout type="warn" title="Prerequisite: Railway account">
  To deploy to Railway, you need to have an account. You can create one [here](https://railway.app/signup).
</Callout>

<Steps>
  <Step>
    ## Create new project

    We'll use [Railway](https://railway.app) web app to deploy our project. First, let's create a new project.

    ![Railway create project](/images/docs/web/deployment/railway/create-project.png)

    Proceed with the option to *Deploy from Github repo*.
  </Step>

  <Step>
    ## Connect repository

    Choose the Git provider of your project and select the repository you want to deploy.

    ![Connect repository](/images/docs/web/deployment/railway/connect-repository.png)

    <Callout title="Authorization needed">
      If your repository is private you need to authorize Railway to access it. It's recommended to follow a *least privileged access* approach, so to only grant access to the repository you want to deploy, not the entire account.
    </Callout>
  </Step>

  <Step>
    ## Configure project settings

    Finalize your deployment by configuring the build settings to match your project's specific needs. Refer to the points below to ensure a seamless deployment process.

    ### Commands

    Configure the build and start commands to ensure that your project is built and started correctly.

    ![Railway project commands](/images/docs/web/deployment/railway/commands.png)

    Make sure to set them to the following values:

    * **Build command** - `pnpm dlx turbo build --filter=web`
    * **Start command** - `pnpm --filter=web start`

    ### Environment variables

    Last, but not least, you need to set the environment variables for your project. Make sure to check if all the required variables are set.

    ![Railway environment variables](/images/docs/web/deployment/railway/environment-variables.png)

    <Callout title="Customize region for better performance and reliability">
      If you want to achieve better performance, lower latency in your API requests or add some replicas of your application, you can customize the region of your Railway instance. Make sure to set it to the region closest to your database and users.

      ![Railway region](/images/docs/web/deployment/railway/region.png)
    </Callout>

    You can also use a [Railway config file](https://docs.railway.com/guides/config-as-code) to manage your project's settings in one place, as a code.
  </Step>

  <Step>
    ## Deploy!

    Click on the *Deploy* button to start the deployment process.

    ![Railway deploy](/images/docs/web/deployment/railway/deploy.png)

    That's it! Your app is now deployed to Railway, congratulations! 🎉
  </Step>
</Steps>

Feel free to scale your deployment to multiple regions or isolate it in the separate network. Check out the [Railway documentation](https://docs.railway.app) for more information about which services are available.
