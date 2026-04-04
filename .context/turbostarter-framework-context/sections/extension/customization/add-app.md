---
title: Adding apps
description: Learn how to add apps to your Turborepo workspace.
url: /docs/extension/customization/add-app
---

# Adding apps

<Callout title="Advanced topic" type="warn">
  This is an **advanced topic** - you should only follow these instructions if you are sure you want to add a new app to your TurboStarter project within your monorepo and want to keep pulling updates from the TurboStarter repository.
</Callout>

In some ways - creating a new repository may be the easiest way to manage your application. However, if you want to keep your application within the monorepo and pull updates from the TurboStarter repository, you can follow these instructions.

To pull updates into a separate application outside of `extension` - we can use [git subtree](https://www.atlassian.com/git/tutorials/git-subtree).

Basically, we will create a subtree at `apps/extension` and create a new remote branch for the subtree. When we create a new application, we will pull the subtree into the new application. This allows us to keep it in sync with the `apps/extension` folder.

To add a new app to your TurboStarter project, you need to follow these steps:

<Steps>
  <Step>
    ## Create a subtree

    First, we need to create a subtree for the `apps/extension` folder. We will create a branch named `extension-branch` and create a subtree for the `apps/extension` folder.

    ```bash
    git subtree split --prefix=apps/extension --branch extension-branch
    ```
  </Step>

  <Step>
    ## Create a new app

    Now, we can create a new application in the `apps` folder.

    Let's say we want to create a new app `ai-chat` at `apps/ai-chat` with the same structure as the `apps/extension` folder (which acts as the template for all new apps).

    ```bash
    git subtree add --prefix=apps/ai-chat origin extension-branch --squash
    ```

    You should now be able to see the `apps/ai-chat` folder with the contents of the `apps/extension` folder.
  </Step>

  <Step>
    ## Update the app

    When you want to update the new application, follow these steps:

    ### Pull the latest updates from the TurboStarter repository

    The command below will update all the changes from the TurboStarter repository:

    ```bash
    git pull upstream main
    ```

    ### Push the `extension-branch` updates

    After you have pulled the updates from the TurboStarter repository, you can split the branch again and push the updates to the extension-branch:

    ```bash
    git subtree split --prefix=apps/extension --branch extension-branch
    ```

    Now, you can push the updates to the `extension-branch`:

    ```bash
    git push origin extension-branch
    ```

    ### Pull the updates to the new application

    Now, you can pull the updates to the new application:

    ```bash
    git subtree pull --prefix=apps/ai-chat origin extension-branch --squash
    ```
  </Step>
</Steps>

That's it! You now have a new application in the monorepo 🎉
