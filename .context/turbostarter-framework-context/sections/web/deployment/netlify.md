---
title: Netlify
description: Learn how to deploy your TurboStarter app to Netlify.
url: /docs/web/deployment/netlify
---

# Netlify

[Netlify](https://netlify.com) is a powerful platform for deploying modern web applications. It offers continuous deployment, serverless functions, and a global CDN to ensure your application is fast and reliable.

In this guide, we will walk through the steps to deploy your TurboStarter app to Netlify. You will learn how to connect your repository, configure build settings, and manage environment variables to ensure a smooth deployment process.

<Callout type="warn" title="Prerequisite: Netlify account">
  To deploy to Netlify, you need to have an account. You can create one [here](https://netlify.com/signup).
</Callout>

<Steps>
  <Step>
    ## Create new site

    Once you've created your account and logged in, the Netlify dashboard will display an option to add a new site. Click on the *Import from Git* button to begin connecting your Git repository.

    ![Create new site](/images/docs/web/deployment/netlify/create-site.png)

    If you've already had a Netlify account, you can get to this step by clicking on the *Sites* tab in the navigation menu.
  </Step>

  <Step>
    ## Connect your repository

    Choose the Git provider of your project and select the repository you want to deploy.

    ![Connect repository](/images/docs/web/deployment/netlify/connect-repository.png)

    <Callout title="Authorization needed">
      To connect your repository, you need to authorize Netlify to access it. It's recommended to follow a *least privileged access* approach, so to only grant access to the repository you want to deploy, not the entire account.
    </Callout>
  </Step>

  <Step>
    ## Configure build settings

    Last step before deploying! Configure the build settings according to your project configuration. Use the screenshots provided below for reference to ensure a smooth deployment process.

    ![Netlify build settings](/images/docs/web/deployment/netlify/build-settings.png)

    Also, add all environment variables under *Environment variables* section - it's required to make the build process work.
  </Step>

  <Step>
    ## Deploy!

    Click on the *Deploy* button to start the deployment process.

    ![Netlify deploy](/images/docs/web/deployment/netlify/deploy.png)

    That's it! Your app is now deployed to Netlify, congratulations! 🎉
  </Step>
</Steps>

<Callout title="Customize region for better performance">
  If you want to achieve better performance and lower latency in your API requests, you can customize the region of your Netlify serverless functions. Make sure to set it to the region closest to your database and users.

  ![Netlify region](/images/docs/web/deployment/netlify/region.png)

  Unfortunately, it's a paid feature, so you need to upgrade your Netlify account to be able to change it.
</Callout>
