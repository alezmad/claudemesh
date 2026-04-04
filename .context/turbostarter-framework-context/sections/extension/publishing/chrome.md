---
title: Chrome Web Store
description: Publish your extension to Google Chrome Web Store.
url: /docs/extension/publishing/chrome
---

# Chrome Web Store

[Chrome Web Store](https://chromewebstore.google.com/) is the most popular store for browser extensions, as it makes them available in any Chromium-based browser, including Google Chrome, Edge, Brave, and many others.

To submit your extension to Chrome Web Store, you'll need to complete a few steps. Here, we'll go through them.

<Callout title="Prerequisite" type="warn">
  Make sure your extension follows the [guidelines](/docs/extension/marketing) and other requirements to increase your chances of getting approved.
</Callout>

## Developer account

Before you can publish items on the Chrome Web Store, you must register as a CWS developer and pay a one-time registration fee. You must provide a developer email when you create your developer account.

To register, just access the [developer console](https://chrome.google.com/webstore/devconsole). The first time you do this, the following registration screen will appear. First, agree to the developer agreement and policies, then pay the registration fee.

![Chrome registration fee](/images/docs/extension/chrome/fee.png)

Once you pay the registration fee and agree to the terms, your account will be created, and you'll be able to proceed to fill out additional information about it.

![Chrome developer account](/images/docs/extension/chrome/account.png)

There are a few fields that you'll need to fill in:

* **Publisher name**: Appears under the title of each of your extensions. If you are a verified publisher, you can display an official publisher URL instead.
* **Verified email**: Verifying your contact email address is required when you set up a new developer account. It's only displayed under your extensions' contact information. Any notifications will be sent to your Chrome Web Store developer account email.
* **Physical address**: Only items that offer functionality to purchase items, additional features, or subscriptions must include a physical address.

<Card title="Register your developer account" href="https://developer.chrome.com/docs/webstore/register" description="developer.chrome.com" />

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

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Sign in to your developer account.
3. Click on the *Add new item* button.
4. Click *Choose file* > *your zip file* > *Upload*. If your item's manifest and other contents are valid, you will see a new item in the dashboard.

![Chrome extension page](/images/docs/extension/chrome/extension-page.png)

After you upload the bundle, you'll need to fill in the extension's details, such as the icons, privacy settings, permissions justification, and other information.

Please refer to the official guides on how to set up your extension's details.

<Cards>
  <Card title="Complete your listing information" href="https://developer.chrome.com/docs/webstore/cws-dashboard-listing" description="developer.chrome.com" />

  <Card title="Fill out the privacy fields" description="developer.chrome.com" href="https://developer.chrome.com/docs/webstore/cws-dashboard-privacy" />

  <Card title="Declare payment and set visibility" description="developer.chrome.com" href="https://developer.chrome.com/docs/webstore/cws-dashboard-distribution" />
</Cards>

### Automated submission

<Callout title="First submission must be done manually" type="warn">
  The first submission of your extension to Chrome Web Store must be done manually because you need to provide the store's credentials and extension ID to automation, which will be available only after the first bundle upload.
</Callout>

TurboStarter comes with a pre-configured GitHub Actions workflow to submit your extension to web stores automatically. It's located in the `.github/workflows/publish-extension.yml` file.

What you need to do is fill the environment variables with your store's credentials and extension's details and set them as a [secrets in your Github repository](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) under correct names:

```yaml title="publish-extension.yml"
env:
  CHROME_EXTENSION_ID: ${{ secrets.CHROME_EXTENSION_ID }}
  CHROME_CLIENT_ID: ${{ secrets.CHROME_CLIENT_ID }}
  CHROME_CLIENT_SECRET: ${{ secrets.CHROME_CLIENT_SECRET }}
  CHROME_REFRESH_TOKEN: ${{ secrets.CHROME_REFRESH_TOKEN }}
```

Please refer to the [official guide](https://github.com/PlasmoHQ/bms/blob/main/tokens.md#chrome-web-store-api) to learn how to get these credentials correctly.

That's it! You can [run the workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow) and it will submit your extension to the Chrome Web Store 🎉

<Callout title="Automated submission to review">
  This workflow will also try to send your extension to review, but it's not guaranteed to happen. You need to have all required information filled in your extension's details page to make it possible.

  Even then, when you introduce some **breaking change** (e.g. add another permission), you'll need to update your extension store metadata and automatic submit won't be possible.

  To opt out of this behavior (and use only automatic uploading to store, but not sending to review) you can set `--chrome-skip-submit-review` flag in the `publish-extension.yml` file for the `wxt submit` command:

  ```yaml title="publish-extension.yml"
  // [!code word:--chrome-skip-submit-review]
  - name: 💨 Publish!
    run: |
      npx wxt submit \
        --chrome-zip apps/extension/build/*-chrome.zip --chrome-skip-submit-review
  ```

  Then, your extension bundle will be uploaded to the store, but you will need to send it to review manually.

  Check out the [official documentation](https://wxt.dev/api/cli/wxt-submit) for more customization options.
</Callout>

<Cards>
  <Card title="Use the Chrome Web Store Publish API" href="https://developer.chrome.com/docs/webstore/using-api" description="developer.chrome.com" />

  <Card title="How to generate Google API tokens?" href="https://github.com/PlasmoHQ/chrome-webstore-api/blob/main/token.md" description="github.com" />
</Cards>

## Review

After filling out the information about your item, you are ready to send it to review. Click on *Submit for review* button and confirm that you want to submit your item in the following dialog:

![Chrome submit for review](/images/docs/extension/chrome/send-to-review.png)

The confirmation dialog shown above also lets you control the timing of your item's publishing. If you uncheck the checkbox, your item will **not** be published immediately after its review is complete. Instead, you'll be able to manually publish it at a time of your choosing once the review is complete.

After you submit the item for review, it will undergo a review process. The time for this review depends on the nature of your item. See [Understanding the review process](https://developer.chrome.com/docs/webstore/review-process) for more details.

There are important emails like take down or rejection notifications that are enabled by default. To receive an email notification when your item is published or staged, you can enable notifications on the *Account page*.

![Chrome notifications](/images/docs/extension/chrome/notifications.png)

The review status of your item appears in the [developer dashboard](https://chrome.google.com/webstore/devconsole) next to each item. The status can be one of the following:

* **Published**: Your item is available to all users.
* **Pending**: Your item is under review.
* **Rejected**: Your item was rejected by the store.
* **Taken Down**: Your item was taken down by the store.

![Chrome extension status](/images/docs/extension/chrome/review-status.png)

You'll receive an email notification when the status of your item changes.

<Callout title="Your submission might be rejected" type="error">
  If your extension has been determined to violate one or more terms or policies, you will receive an email notification that contains the violation description and instructions on how to rectify it.

  If you did not receive an email within a week, check the status of your item. If your item has been rejected, you can see the details on the *Status* tab of your item.

  ![Chrome extension rejected](/images/docs/extension/chrome/rejection.png)

  You'll need to fix the issues and upload a new version of your extension, make sure to follow the [guidelines](/docs/extension/marketing) or check [publishing troubleshooting](/docs/extension/troubleshooting/publishing) for more info.

  If you have been informed about a violation and you do not rectify it, your item will be taken down. See [Violation enforcement](https://developer.chrome.com/docs/webstore/review-process#enforcement) for more details.
</Callout>

You can learn more about the review process in the official guides listed below.

<Cards>
  <Card title="Chrome Web Store review process" href="https://developer.chrome.com/docs/webstore/review-process" description="developer.chrome.com" />

  <Card title="Troubleshooting Chrome Web Store violations" href="https://developer.chrome.com/docs/webstore/troubleshooting" description="developer.chrome.com" />
</Cards>
