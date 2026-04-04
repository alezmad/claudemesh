---
title: Updates
description: Learn how to update your published app.
url: /docs/mobile/publishing/updates
---

# Updates

After you publish your app to the stores, you can release updates to provide your users with new features and bug fixes.

TurboStarter offers two ready-to-use methods for updating your apps; we'll walk through both of them below.

## Over-the-air (OTA) updates

[Over-the-air (OTA) updates](https://en.wikipedia.org/wiki/Over-the-air_update) allow you to push updates to your app without requiring users to download a new version from the app store. This powerful feature enables rapid iteration and quick fixes.

![OTA updates](/images/docs/mobile/ota-updates.png)

TurboStarter integrates with [EAS Update](https://docs.expo.dev/eas-updates/overview/) to provide you with a seamless experience for managing your app updates. We also shipped a native notification that you can use to notify your users about the new updates available.

Then, to push your update straight to your users, you'll just need to run single command:

```bash
eas update --channel [channel-name] --message "[message]"
```

The app will automatically download the update in the background and install it when your users are ready. You can also configure the update channel and message to be displayed to your users.

Feel free to check the [official documentation](https://docs.expo.dev/eas-update/getting-started/) for more information.

<Callout title="Working only for non-native changes" type="warn">
  OTA updates are **only supported for non-native changes**. If you need to update your app with a new native feature (or add a package that uses native dependencies), you'll need to submit a new version to the stores - see below for more details.
</Callout>

## Submitting a new version

The most traditional way to update your app is to submit a new version to the stores. This is the most reliable approach, but it can take some time for the new version to be approved and made available to users.

To submit a new version, update the version number in both your `package.json` file and your `app.config.ts` file.

```json
{
    ...
    "version": "1.0.0", // [!code --]
    "version": "1.0.1", // [!code ++]
    ...
}
```

Next, follow the exact same steps as [when you initially published your app](/docs/mobile/publishing/checklist). When you submit your app for review, be sure to include release notes for the new version.
