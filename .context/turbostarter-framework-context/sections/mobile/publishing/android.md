---
title: Google Play (Android)
description: Learn how to publish your mobile app to the Google Play Store.
url: /docs/mobile/publishing/android
---

# Google Play (Android)

[Google Play](https://play.google.com/) is the primary platform for distributing Android apps to billions of users worldwide. It's a powerful marketplace that allows you to reach a large audience and monetize your app.

To submit your app to the Play Store, you'll need to follow a series of steps. We'll walk through those steps here.

<Callout title="Prerequisite" type="warn">
  Before you submit, review the publishing [guidelines](/docs/mobile/marketing) and confirm that your app meets Google's policies to avoid common rejections.
</Callout>

## Developer account

A Google Play Developer account is required to submit your app to the Google Play Store. You can sign up on the [Google Play Console](https://play.google.com/console/) and pay the one-time registration fee.

![Google Play Developer Account](/images/docs/mobile/publishing/android/developer-account.png)

To publish apps to Google Play, you must verify your identity. See the [official guide](https://support.google.com/googleplay/android-developer/answer/14177239) for more information. Next, you'll need to create a new app in the [Google Play Console](https://play.google.com/apps/publish/) by clicking the *Create app* button.

## Submission

After registering your developer account, setting it up, and preparing your app, you're ready to publish it to the Play Store.

There are multiple ways to submit your app:

* **Manual submission:** Upload your app bundle directly to the Play Store via the Play Console.
* **Local submission:** Use [EAS CLI](https://github.com/expo/eas-cli) to submit your app.
* **CI/CD submission:** Use ready-to-use GitHub Actions workflow to automatically submit your app.

**The first submission must be done manually, while subsequent updates can be submitted automatically.** We'll go through each approach in detail below.

### Manual submission

This approach is not recommended, as it is more error-prone and time-consuming due to manual steps. However, it's still the **only way to submit your app for the first time**. You can also use this route if you need to upload a build without EAS Submit (for example, during service maintenance) or if you prefer a fully manual flow.

**Create the app entry in Google Play Console**

1. Visit [Google Play Console](https://play.google.com/console/) and sign in. Accept any pending agreements if prompted.
2. Click *Create app*, then enter your app name, default language, app type, and pricing (free/paid). Confirm policy declarations.
3. Finish initial setup tasks (App access, Ads, Content rating, Target audience, Data safety, Privacy policy URL).

**Upload the `.aab` file to a track (internal/closed/open/production)**

1. The fastest route for a first upload is often *Internal testing*. Go to *Internal testing* → *Releases* (or choose *Closed/Open/Production*), then click *Create new release*.
2. Upload the `.aab` file, add release notes, and review any warnings.
3. Save and continue through the checks until you're ready to submit for review or roll out to [testers](https://play.google.com/console/about/internal-testing/).

**Verify and submit for review**

1. Complete Store listing assets and metadata if not already done.
2. Resolve any policy warnings. When ready, start the rollout to request a [review](/docs/mobile/publishing/android#review).

After your first manual upload is accepted, you can use [Local submission](/docs/mobile/publishing/android#local-submission) or [CI/CD submission](/docs/mobile/publishing/android#cicd-submission-recommended) for subsequent releases.

For more information, please refer to the guides listed below.

<Cards>
  <Card title="First Android submission" url="https://github.com/expo/fyi/blob/main/first-android-submission.md" description="expo.fyi" />

  <Card title="Create and set up your app" url="https://support.google.com/googleplay/android-developer/answer/9859152" description="google.com" />
</Cards>

### Local submission

<Callout title="First submission must be done manually" type="warn">
  Due to Google Play API limitations, you must upload your app to Google Play **manually at least once** (to any track: internal, closed, open, or production) before automated submissions will work. See the detailed walkthrough in the ["First Android submission" guide](https://github.com/expo/fyi/blob/main/first-android-submission.md).
</Callout>

First, you need to **upload and configure a Google Service Account Key with EAS**. This is the required first step to submit your Android app to the Google Play Store. Follow the [guide on uploading a Google Service Account Key for Play Store submissions with EAS](https://github.com/expo/fyi/blob/main/creating-google-service-account.md) for detailed instructions.

Next, you have to get your app bundle — if you followed the [checklist](/docs/mobile/publishing/checklist), you should have the `.aab` file in your app folder from the [build step](/docs/mobile/publishing/checklist#build-your-app). If you used GitHub Actions to build your app, you can find the results in the `Builds` tab of your [EAS project](https://expo.dev). Download the artifacts and save them on your local machine.

Then, navigate to your app folder and run the following command to submit your app to the Play Store:

```bash
eas submit --platform android
```

The command will guide you through the submission process. You can also configure the steps of the submission process by adding a submission profile in `eas.json`.

<Callout>
  If you upload your Google Service Account key to EAS credentials, you do not need to reference a local file path anywhere.
</Callout>

To speed up the submission process, you can use the `--auto-submit` flag to automatically submit a build after it is built:

```bash
eas build --platform android --auto-submit
```

This will automatically submit the build with all the required credentials to the Play Store right after it is built.

<Cards>
  <Card title="Automate submissions" description="docs.expo.dev" href="https://docs.expo.dev/build/automate-submissions/" />

  <Card title="Creating a Google Service Account" description="expo.fyi" href="https://github.com/expo/fyi/blob/main/creating-google-service-account.md" />

  <Card title="eas.json reference" description="docs.expo.dev" href="https://docs.expo.dev/eas/json/#android-specific-options-1" />
</Cards>

### CI/CD submission (recommended)

<Callout title="First submission must be done manually" type="warn">
  Due to Google Play API limitations, you must upload your app to Google Play **manually at least once** (to any track: internal, closed, open, or production) before automated submissions will work. See the detailed walkthrough in the ["First Android submission" guide](https://github.com/expo/fyi/blob/main/first-android-submission.md).
</Callout>

TurboStarter comes with a pre-configured GitHub Actions workflow to automatically submit your mobile app to the Play Store. You'll find the workflow in the `.github/workflows/publish-mobile.yml` file.

To use this workflow, [upload your Google Play Service Account key to EAS](https://github.com/expo/fyi/blob/main/creating-google-service-account.md) and check your Android credentials setup by running:

```bash
eas credentials --platform android
```

This way, you avoid storing the JSON key in your repository or CI/CD provider.

<Callout title="Don't forget to set EXPO_TOKEN">
  This workflow also requires a [personal access token](https://docs.expo.dev/accounts/programmatic-access/#personal-access-tokens) for your Expo account. Add it as `EXPO_TOKEN` in your [GitHub repository secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions), which will allow the `eas submit` command to run.
</Callout>

That's it! After completing these steps, [trigger the workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow) to submit your new build to the Play Store automatically 🎉

<Cards>
  <Card title="Automate submissions" description="docs.expo.dev" href="https://docs.expo.dev/build/automate-submissions/" />

  <Card title="Creating a Google Service Account" description="expo.fyi" href="https://github.com/expo/fyi/blob/main/creating-google-service-account.md" />

  <Card title="eas.json reference" description="docs.expo.dev" href="https://docs.expo.dev/eas/json/#android-specific-options-1" />
</Cards>

## Review

After filling out the information about your item, you're ready to submit it for review. Click on the *Send for review* button and confirm that you want to proceed with the submission:

![Send for review](/images/docs/mobile/publishing/android/send-for-review.png)

To control **when** your app is released after review, you can configure [Managed publishing](https://support.google.com/googleplay/android-developer/answer/9859654) in the Google Play Console.

After submitting your app for review, it will enter Google's review process. The review time may vary depending on your app, and you'll receive a notification when the status updates. For more details, check out the [Google Play Review Process](https://developers.google.com/workspace/marketplace/about-app-review) documentation.

<Callout title="Your submission might be rejected" type="error">
  If your submission is rejected, you'll receive an email from Google with the rejection reason. You'll need to fix the issues and upload a new version of your app.

  ![Google Play Rejection](/images/docs/mobile/publishing/android/rejection.png)

  Make sure to follow the [guidelines](/docs/mobile/marketing) or check [publishing troubleshooting](/docs/mobile/troubleshooting/publishing) for more info.
</Callout>

When your app is approved by Google, you'll be able to publish it on the Play Store.

![Your update is live email from Google](/images/docs/mobile/publishing/android/update-live.png)

You can learn more about the review process in the official guides listed below.

<Cards>
  <Card title="App review process" description="google.com" href="https://developers.google.com/workspace/marketplace/about-app-review" />

  <Card title="Google Play branding guidelines" description="google.com" href="https://developers.google.com/workspace/marketplace/terms/branding" />
</Cards>
