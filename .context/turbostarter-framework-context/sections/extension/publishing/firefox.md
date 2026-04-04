---
title: Firefox Add-ons
description: Publish your extension to Mozilla Firefox Add-ons.
url: /docs/extension/publishing/firefox
---

# Firefox Add-ons

Mozilla Firefox doesn't share extensions with [Google Chrome](/docs/extension/publishing/chrome), so you'll need to publish your extension to it separately.

Here, we'll go through the process of publishing an extension to [Firefox Add-ons](https://addons.mozilla.org/).

<Callout title="Prerequisite" type="warn">
  Make sure your extension follows the [guidelines](/docs/extension/marketing) and other requirements to increase your chances of getting approved.
</Callout>

## Developer account

Before you can publish items on Firefox Add-ons, you must register a developer account. In comparison to the Chrome Web Store, Firefox Add-ons doesn't require a registration fee.

To register, go to [addons.mozilla.org](https://addons.mozilla.org/) and click on the *Register* button.

![Mozilla registration](/images/docs/extension/firefox/portal.png)

It's important to set at least a display name on your profile to increase transparency with users, add-on reviewers, and the greater community.

You can do it in the *Edit My Profile* section:

![Mozilla profile](/images/docs/extension/firefox/profile.png)

<Card title="Developer accounts" href="https://extensionworkshop.com/documentation/publish/developer-accounts/" description="extensionworkshop.com" />

## Submission

After registering your developer account, setting it up, and preparing your extension, you're ready to publish it to the store.

You can submit your extension in two ways:

* **Manually**: By uploading your extension's bundle directly to the store.
* **Automatically**: By using GitHub Actions to submit your extension to the stores.

**The first submission must be done manually, while subsequent updates can be submitted automatically.** We'll go through both approaches.

### Manual submission

To manually submit your extension to stores, you will first need to get your extension bundle. If you ran the build step locally, you should already have the `.zip` file in your extension's `build` folder.

If you used GitHub Actions to build your extension, you can find the results in the workflow run. Download the artifacts and save them on your local machine.

Then, use the following steps to upload your item:

<Steps>
  <Step>
    #### Sign in to your developer account

    Go to the [Add-ons Developer Hub](https://addons.mozilla.org/developers/) and sign in to your developer account.
  </Step>

  <Step>
    #### Choose distribution method

    You should reach the following page:

    ![Mozilla distribution](/images/docs/extension/firefox/distribution.png)

    Here, you have two ways of distributing your extension:

    * **On this site**, if you want your add-on listed on AMO (Add-ons Manager).
    * **On your own**, if you plan to distribute the add-on yourself and don't want it listed on AMO.

    We recommend going with the first option, as it will allow you to reach more users and get more feedback. If you decide to go with the second option, please refer to the [official documentation](https://extensionworkshop.com/documentation/publish/self-distribution/) for more details.
  </Step>

  <Step>
    #### Submit your extension

    On the next page, click on *Select file* and choose your extension's `.zip` bundle.

    ![Mozilla upload](/images/docs/extension/firefox/upload.png)

    Once you upload the bundle, the validator checks the add-on for issues and the page updates:

    ![Mozilla validation](/images/docs/extension/firefox/validation.png)

    If your add-on passes all the checks, you can proceed to the next step.

    <Callout type="warn">
      You may receive a message that you only have warnings. It's advisable to address these warnings, particularly those flagged as security or privacy issues, as they may result in your add-on failing review. However, **you can continue with the submission**.
    </Callout>

    If the validation fails, you'll need to address the issues and upload a new version of your add-on.
  </Step>

  <Step>
    #### Submit source code (if needed)

    You'll need to indicate whether you need to provide the source code of your extension:

    ![Mozilla source code](/images/docs/extension/firefox/source-code.png)

    If you select *Yes*, a section displays describing what you need to submit. Click *Browse* and locate and upload your source code package. See [Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/) for more information.

    <Callout type="warn">
      You may receive a message that you only have warnings. It's advisable to address these warnings, particularly those flagged as security or privacy issues, as they may result in your add-on failing review. However, **you can continue with the submission**.
    </Callout>

    If the validation fails, you'll need to address the issues and upload a new version of your add-on.
  </Step>

  <Step>
    #### Add metadata

    On the next page, you'll need to provide the following additional information about your extension:

    ![Mozilla additional information](/images/docs/extension/firefox/additional-info.png)

    * **Name**: Your add-on's name.
    * **Add-on URL**: The URL for your add-on on AMO. A URL is automatically assigned based on your add-on's name. To change this, click Edit. The URL must be unique. You will be warned if another add-on is using your chosen URL, and you must enter a different one.
    * **Summary**: A useful and descriptive short summary of your add-on.
    * **Description**: A longer description that provides users with details of the extension's features and functionality.
    * **This add-on is experimental**: Indicate if your add-on is experimental or otherwise not ready for general use. The add-on will be listed but with reduced visibility. You can remove this flag when your add-on is ready for general use.
    * **This add-on requires payment, non-free services or software, or additional hardware**: Indicate if your add-on requires users to make an additional purchase for it to work fully.
    * **Select up to 2 Firefox categories for this add-on**: Select categories that describe your add-on.
    * **Select up to 2 Firefox for Android categories for this add-on**: Select categories that describe your add-on.
    * **Support email and Support website**: Provide an email address and website where users can get in touch when they have questions, issues, or compliments.
    * **License**: Select the appropriate license for your add-on. Click Details to learn more about each license.
    * **This add-on has a privacy policy**: If any data is being transmitted from the user's device, a privacy policy explaining what is being sent and how it's used is required. Check this box and provide the privacy policy.
    * **Notes for Reviewers**: Provide information to assist the AMO reviewer, such as login details for a dummy account, source code information, or similar.
  </Step>

  <Step>
    #### Finalize the process

    Once you're ready, click on the *Submit Version* button.

    ![Mozilla submit](/images/docs/extension/firefox/submit.png)

    You can still edit your add-on's details from the dedicated page after submission.
  </Step>
</Steps>

<Cards>
  <Card title="Resources for publishers" href="https://extensionworkshop.com/documentation/manage/resources-for-publishers/" description="extensionworkshop.com" />

  <Card title="Source code submission" href="https://extensionworkshop.com/documentation/publish/source-code-submission/" description="extensionworkshop.com" />
</Cards>

### Automated submission

<Callout title="First submission must be done manually" type="warn">
  The first submission of your extension to Firefox Add-ons must be done manually because you need to provide the store's credentials and extension ID to automation, which will be available only after the first bundle upload.
</Callout>

TurboStarter comes with a pre-configured GitHub Actions workflow to submit your extension to web stores automatically. It's located in the `.github/workflows/publish-extension.yml` file.

What you need to do is fill the environment variables with your store's credentials and extension's details and set them as a [secrets in your Github repository](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) under correct names:

```yaml title="publish-extension.yml"
env:
  FIREFOX_EXTENSION_ID: ${{ secrets.FIREFOX_EXTENSION_ID }}
  FIREFOX_JWT_ISSUER: ${{ secrets.FIREFOX_JWT_ISSUER }}
  FIREFOX_JWT_SECRET: ${{ secrets.FIREFOX_JWT_SECRET }}
```

Please refer to the [official guide](https://github.com/PlasmoHQ/bms/blob/main/tokens.md#firefox-add-ons-api) to learn how to get these credentials correctly.

That's it! You can [run the workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow) and it will submit your extension to the Firefox Add-ons 🎉

<Callout title="Automated submission to review">
  This workflow will also try to send your extension to review, but it's not guaranteed to happen. You need to have all required information filled in your extension's details page to make it possible.

  Even then, when you introduce some **breaking change** (e.g., add another permission), you'll need to update your extension store metadata and automatic submission won't be possible.
</Callout>

<Cards>
  <Card title="A new API for submitting and updating add-ons" href="https://blog.mozilla.org/addons/2022/03/17/new-api-for-submitting-and-updating-add-ons/" description="blog.mozilla.org" />

  <Card title="Mozilla API keys" href="https://addons.mozilla.org/en-US/developers/addon/api/key/" description="addons.mozilla.org" />
</Cards>

## Review

Once you submit your extension bundle, it's automatically sent to review and will undergo a review process. The time for this review depends on the nature of your item.

The add-on review process includes the following phases:

1. **Automatic Review**: Upon upload, the add-on undergoes several automatic validation steps to ensure its general safety.
2. **Content Review**: Shortly after submission, a human reviewer inspects the add-on to ensure that the listing adheres to content review guidelines, including metadata such as the add-on name and description.
3. **Technical Code Review**: The add-on's source code is examined to ensure compliance with review policies.
4. **Basic Functionality Testing**: After the source code is verified as safe, the add-on undergoes basic functionality testing to confirm it operates as described.

There are important emails like takedown or rejection notifications that are enabled by default. To receive an email notification when your item is published or staged, you can enable notifications in the *Account Settings*.

![Mozilla notifications](/images/docs/extension/firefox/notifications.png)

The review status of your item appears in the [developer hub](https://addons.mozilla.org/en-US/firefox/) next to each item.

![Mozilla review status](/images/docs/extension/firefox/review-status.png)

You'll receive an email notification when the status of your item changes.

<Callout title="Your submission might be rejected" type="error">
  If your extension has been determined to violate one or more terms or policies, you will receive an email notification that contains the violation description and instructions on how to rectify it.

  You can also check the reason behind the rejection on the *Status* page of your item.

  ![Mozilla extension rejected](/images/docs/extension/firefox/rejection.png)

  You'll need to fix the issues and upload a new version of your extension. Make sure to follow the [guidelines](/docs/extension/marketing) or check [publishing troubleshooting](/docs/extension/troubleshooting/publishing) for more info.
</Callout>

You can learn more about the review process in the official guides listed below.

<Cards>
  <Card title="Add-ons/Reviewers/Guide/Reviewing" href="https://wiki.mozilla.org/Add-ons/Reviewers/Guide/Reviewing" description="wiki.mozilla.org" />

  <Card title="Add-ons/Reviewers/Content Review Guidelines" href="https://wiki.mozilla.org/Add-ons/Reviewers/Content_Review_Guidelines" description="wiki.mozilla.org" />
</Cards>
