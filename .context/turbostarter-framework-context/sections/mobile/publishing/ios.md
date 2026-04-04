---
title: App Store (iOS)
description: Learn how to publish your mobile app to the Apple App Store.
url: /docs/mobile/publishing/ios
---

# App Store (iOS)

[Apple App Store](https://www.apple.com/app-store/) is the primary platform for distributing iOS apps, making them available on iPhones, iPads, and other Apple devices to millions of users worldwide.

To submit your app to the App Store, you'll need to follow a series of steps. We'll walk through those steps here.

<Callout title="Prerequisite" type="warn">
  Before you submit, review the publishing [guidelines](/docs/mobile/marketing) and confirm that your app meets Apple's policies to avoid common rejections.
</Callout>

## Developer account

An Apple Developer account is required to submit your app to the Apple App Store. You can sign up for an Apple Developer account on the [Apple Developer Portal](https://developer.apple.com/account/).

![Apple Developer Account](/images/docs/mobile/publishing/ios/developer-account.png)

To submit apps to the App Store, you must also be a member of the Apple Developer Program. You can join the program by paying the annual fee.

## Submission

There are two primary ways to submit your iOS app to the App Store:

* **Manual:** Uploading the build yourself through Apple's tools, such as [Transporter](https://apps.apple.com/app/transporter/id1450874784) or [Xcode](https://developer.apple.com/xcode/).
* **Automatic (recommended):** Using [EAS Submit](/docs/mobile/publishing/ios#local-submission) or [CI/CD](/docs/mobile/publishing/ios#cicd-submission-recommended), which simplifies the process, ensures consistency, and reduces manual error.

Below, you'll find guidance for both submission methods—choose the one that fits your workflow and project needs.

### Manual submission

This approach is not recommended, as it is more error-prone and time-consuming due to manual steps. Use this route if you need to upload a build without EAS Submit (for example, during service maintenance) or prefer a fully manual flow from macOS.

**Create the app entry in App Store Connect**

1. Visit [App Store Connect](https://appstoreconnect.apple.com/) and sign in. Accept any pending agreements if prompted.
2. From Apps, click the + button and select *New App*.
3. Enter the app name, primary language, bundle identifier, and a unique SKU (for example, your bundle ID, such as `com.company.myapp`).
4. Press Create to finish setting up the app record.

**Upload the IPA with Transporter**

1. Install [Apple's Transporter](https://apps.apple.com/app/transporter/id1450874784) from the Mac App Store.
2. Open Transporter and sign in with your Apple ID.
3. Drag the `.ipa` into Transporter (or click *Add App* to choose the file).
4. Press *Deliver* to upload. Transfer time varies by file size and network.

**Verify processing and select the build**

1. Once uploaded, Apple processes the binary (often 10-20 minutes).
2. Back in [App Store Connect](https://appstoreconnect.apple.com/), open My Apps and select your app.
3. Under the *App Store* tab, select the new build in the *Build* section. If it's missing, wait and refresh.
4. Proceed with the usual App Store steps (screenshots, metadata, compliance, then submit for review).

For more information about the required metadata, refer to the official guides.

<Cards>
  <Card title="Submitting" url="https://developer.apple.com/app-store/submitting/" description="developer.apple.com" />

  <Card title="App Information" url="https://developer.apple.com/help/app-store-connect/reference/app-information/" description="developer.apple.com" />
</Cards>

### Local submission

If you followed the [checklist](/docs/mobile/publishing/checklist), you should have the `.ipa` file in your app folder from the [build step](/docs/mobile/publishing/checklist#build-your-app). If you used GitHub Actions to build your app, you can find the results in the `Builds` tab of your [EAS project](https://expo.dev). Download the artifacts and save them on your local machine.

Then, navigate to your app folder and run the following command to submit your app to the App Store:

```bash
eas submit --platform ios
```

The command will guide you through the submission process. You can configure the submission process by adding a submission profile in `eas.json`:

```json title="eas.json"
{
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "your-app-store-connect-app-id"
      }
    }
  }
}
```

<Accordions>
  <Accordion title="How to find ascAppId?">
    1. Sign in to [App Store Connect](https://appstoreconnect.apple.com/) and choose your team.
    2. Open the [Apps](https://appstoreconnect.apple.com/apps) area.
    3. Select your app from the list.
    4. Switch to the *App Store* tab.
    5. Go to *General* → *App Information*.
    6. In *General Information*, the value labeled *Apple ID* is your `ascAppId`.

    ![App Store Connect App Information](/images/docs/mobile/publishing/ios/asc-app-id.png)
  </Accordion>
</Accordions>

To speed up the submission process, you can use the `--auto-submit` flag to automatically submit a build after it is built:

```bash
eas build --platform ios --auto-submit
```

This will automatically submit the build with all the required credentials to the App Store right after it is built.

<Cards>
  <Card title="eas.json reference" description="docs.expo.dev" href="https://docs.expo.dev/eas/json/#ios-specific-options-1" />

  <Card title="Automate submissions" description="docs.expo.dev" href="https://docs.expo.dev/build/automate-submissions/" />
</Cards>

### CI/CD submission (recommended)

TurboStarter comes with a pre-configured GitHub Actions workflow to submit your mobile app to the App Store automatically. It's located in the `.github/workflows/publish-mobile.yml` file.

To be able to use this workflow, you'd need to fulfill the following prerequisites:

1. **Configure your App Store Connect API Key**

   Run the following command to configure your App Store Connect API Key:

   ```bash
   eas credentials --platform ios
   ```

   The command will prompt you to configure credentials:

   1. Choose the `production` build profile.
   2. Authenticate with your Apple Developer account and proceed through the prompts.
   3. Pick **App Store Connect → Manage your API Key**.
   4. Enable **Use an API Key for EAS Submit** for the project.

2. **Provide a submission profile in `eas.json`**

   Next, add a submission profile in `eas.json` with the following:

   ```json title="eas.json"
   {
     "submit": {
       "production": {
         "ios": {
           "ascAppId": "your-app-store-connect-app-id"
         }
       }
     }
   }
   ```

<Accordions>
  <Accordion title="How to find ascAppId?">
    1) Log into [App Store Connect](https://appstoreconnect.apple.com/) under the correct team.
    2) Go to [Apps](https://appstoreconnect.apple.com/apps) and open your app.
    3) Ensure the *App Store* tab is selected.
    4) Navigate to *General* → *App Information*.
    5) Copy the value shown as *Apple ID* — that is the `ascAppId`.

    ![App Store Connect App Information](/images/docs/mobile/publishing/ios/asc-app-id.png)
  </Accordion>
</Accordions>

<Callout title="Don't forget to set EXPO_TOKEN">
  This workflow also requires a [personal access token](https://docs.expo.dev/accounts/programmatic-access/#personal-access-tokens) for your Expo account. Add it as `EXPO_TOKEN` in your [GitHub repository secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions), which will allow the `eas submit` command to run.
</Callout>

That's it! After completing these steps, [trigger the workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow) to submit your new build to the App Store automatically 🎉

<Cards>
  <Card title="eas.json reference" description="docs.expo.dev" href="https://docs.expo.dev/eas/json/#ios-specific-options-1" />

  <Card title="Automate submissions" description="docs.expo.dev" href="https://docs.expo.dev/build/automate-submissions/" />
</Cards>

## Review

After completing your app information, you're ready to submit it for review. Click the *Add for review* button and confirm that you want to proceed with the submission:

![Confirm submission](/images/docs/mobile/publishing/ios/confirm-submission.png)

On the *Distribution* tab, you can configure the release process after the review is complete — whether you want to release the app automatically after review, later, or manually.

![App Store Connect Version Release](/images/docs/mobile/publishing/ios/version-release.png)

Once you've submitted your app for review, it will go through Apple's review process. The duration can vary based on the specifics of your app and you'll be notified when the status changes. For more information, refer to the [App Review](https://developer.apple.com/distribute/app-review/) docs.

<Callout title="Your submission might be rejected" type="error">
  If your submission is rejected, you'll receive an email from Apple with the rejection reason. You'll need to fix the issues and upload a new version of your app.

  ![App Store Connect Rejection](/images/docs/mobile/publishing/ios/rejection.png)

  Make sure to follow the [guidelines](/docs/mobile/marketing) or check [publishing troubleshooting](/docs/mobile/troubleshooting/publishing) for more information.

  If you need to clarify anything with Apple, you can reply to the app review request in App Store Connect:

  ![App Store Connect Reply to Review](/images/docs/mobile/publishing/ios/reply-to-review.png)

  This helps you understand the rejection and what you need to change to make your app eligible for distribution.
</Callout>

When your app is approved by Apple (by email or push notification), you'll be able to publish it on the App Store.

![Review notification](/images/docs/mobile/publishing/ios/review-notifications.jpeg)

You can learn more about the review process in the official guides listed below.

<Cards>
  <Card title="App Review Process" url="https://developer.apple.com/distribute/app-review/" description="developer.apple.com" />

  <Card title="App Review Guidelines" url="https://developer.apple.com/app-store/review/guidelines/" description="developer.apple.com" />
</Cards>
