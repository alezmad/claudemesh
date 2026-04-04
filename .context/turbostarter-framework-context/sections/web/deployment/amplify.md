---
title: AWS Amplify
description: Learn how to deploy your TurboStarter app to AWS Amplify.
url: /docs/web/deployment/amplify
---

# AWS Amplify

[AWS Amplify](https://aws.amazon.com/amplify/) is a fully managed service that makes it easy to build, deploy, and host modern web applications. It provides features like continuous deployment, serverless functions, authentication, and more - all integrated into a seamless developer experience.

This guide explains how to deploy your TurboStarter app on AWS Amplify. You'll learn how to set up your repository for automated deployments, configure build settings, manage environment variables, and ensure your application runs smoothly in production. **AWS Amplify handles the infrastructure management, allowing you to focus on developing your application.**

<Callout type="warn" title="Prerequisite: AWS account">
  To deploy to AWS Amplify, you need to have an AWS account. You can create one [here](https://aws.amazon.com/amplify/).
</Callout>

<Steps>
  <Step>
    ## Create configuration file

    To deploy your TurboStarter app to AWS Amplify, you need to create a config file. This file will contain the necessary information to connect your repository to AWS Amplify and deploy your application.

    Let's create a new file called `amplify.yml` in the root of your project:

    ```yaml title="amplify.yml"
    version: 1
    applications:
      - frontend:
          buildPath: "/"
          phases:
            preBuild:
              commands:
                - npm install -g pnpm
                - pnpm install
            build:
              commands:
                - pnpm dlx turbo build --filter=web
          artifacts:
            baseDirectory: apps/web/.next
            files:
              - "**/*"
          cache:
            paths:
              - node_modules/**/*
              - apps/web/.next/cache/**/*
        appRoot: apps/web
    ```

    This configuration file tells AWS Amplify how to build and deploy your application:

    * The `version` field specifies the Amplify configuration version
    * Under `applications`, we define the build settings for our web app:
      * `buildPath` indicates where to run the build commands
      * `preBuild` phase installs pnpm and project dependencies
      * `build` phase runs the Turborepo build command for the web app
      * `artifacts` specifies which files to deploy (the Next.js build output)
      * `cache` configures which directories to cache between builds
      * `appRoot` points to the web application directory

    AWS Amplify will use this configuration to automatically build and deploy your app whenever you push changes to your repository. It also useful to define other resources that you can use and link to your project.
  </Step>

  <Step>
    ## Create a new Amplify project

    We'll use the [AWS Amplify](https://aws.amazon.com/amplify/) web interface to deploy our app. First, let's create a new project.

    ![Amplify create project](/images/docs/web/deployment/amplify/create-project.png)

    Proceed with the option to *Deploy an app*.
  </Step>

  <Step>
    ## Connect repository

    Choose the Git provider of your project and select the repository you want to deploy.

    ![Amplify connect repository](/images/docs/web/deployment/amplify/connect-repository.png)

    <Callout title="Authorization needed">
      If your repository is private you need to authorize Amplify to access it. It's recommended to follow a *least privileged access* approach, so to only grant access to the repository you want to deploy, not the entire account.
    </Callout>

    Select the branch you want to deploy and make sure to enable the *My app is a monorepo* option - configure it with the path to the app that you want to deploy (e.g. `apps/web`).

    ![Amplify repository and branch](/images/docs/web/deployment/amplify/repository.png)
  </Step>

  <Step>
    ## Configure build settings

    Finalize your deployment by configuring the build settings to match your project's specific needs. Refer to the points below to ensure a seamless deployment process.

    ![Amplify build settings](/images/docs/web/deployment/amplify/build-settings.png)

    Make sure that the build command and build output directory is set to the correct values (it should be defined based on your configuration file from Step 1.).

    ### Environment variables

    In the *Advanced settings* section, you can define environment variables that will be available to your application at runtime.

    ![Amplify environment variables](/images/docs/web/deployment/amplify/environment-variables.png)

    Verify that all required environment variables are defined, so your app can be build and deployed successfully.
  </Step>

  <Step>
    ## Review and deploy!

    On the next step, you'll be able to review the configuration that you've created and deploy your app. It's the right time to make sure that everything is set up correctly.

    ![Amplify review and deploy](/images/docs/web/deployment/amplify/review.png)

    After making sure that everything is set up correctly, you can click on the *Save and deploy* button to start the deployment process.

    When your app is deployed, you'll be able to access it via the URL provided in the Amplify console:

    ![Amplify deployed app](/images/docs/web/deployment/amplify/deployed.png)

    That's it! Your app is now deployed to AWS Amplify, congratulations! 🎉
  </Step>
</Steps>

Feel free to scale your deployment to multiple regions, add custom domains, and use other Amplify features to make your app more robust and scalable.
Check out the [AWS Amplify documentation](https://docs.aws.amazon.com/amplify/latest/userguide/welcome.html) for more information on how to use Amplify to its full potential.
