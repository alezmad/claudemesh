---
title: Firebase project
description: Learn how to set up a Firebase project for your TurboStarter mobile app.
url: /docs/mobile/installation/firebase
---

# Firebase project

For some features of your mobile app, you will need to set up a Firebase project. It's a requirement enforced by how these features are implemented under the hood and we cannot change it.

You would need a Firebase project to use the following features:

* [Analytics](/docs/mobile/analytics/overview) with [Google Analytics](/docs/mobile/analytics/configuration#google-analytics) provider

Here, we'll go through the steps to set up a Firebase project and link it to your mobile app.

<Callout title="Development build required" type="warn">
  In development environment, the integration with Firebase is possible only when using a [development build](https://docs.expo.dev/workflow/overview/#development-builds). It means that **it won't work in the [Expo Go](https://expo.dev/go) app**.
</Callout>

<Steps>
  <Step>
    ## Create a Firebase project

    First things first, you need to create a Firebase project. You can do this by going to the [Firebase console](https://console.firebase.google.com/) and clicking on "Add Project":

    ![Create a Firebase project](/images/docs/mobile/installation/firebase/create-project.png)

    Name it as you want, and proceed to the dashboard.
  </Step>

  <Step>
    ## Install Firebase SDK

    To install React Native Firebase's base app module, run the following command in your mobile app directory:

    ```bash
    npx expo install @react-native-firebase/app
    ```
  </Step>

  <Step>
    ## Configure Firebase modules

    The recommended approach to configure React Native Firebase is to use [Expo Config Plugins](https://docs.expo.dev/config-plugins/introduction/).

    To enable Firebase on the native Android and iOS platforms, create and download Service Account files for each platform from your Firebase project.

    You can find them in the dashboard under the Firebase project settings:

    ![Download Service Account files](/images/docs/mobile/installation/firebase/config-files.png)

    For Android, it will be a `google-services.json` file, and for iOS it will be a `GoogleService-Info.plist` file.

    Then provide paths to the downloaded files in the following `app.config.ts` fields: [`android.googleServicesFile`](https://docs.expo.io/versions/latest/config/app/#googleservicesfile-1) and [`ios.googleServicesFile`](https://docs.expo.io/versions/latest/config/app/#googleservicesfile). This is how an example configuration looks like:

    ```ts title="app.config.ts"
    export default ({ config }: ConfigContext): ExpoConfig => ({
      ...config,
      ios: {
        googleServicesFile: "./GoogleService-Info.plist",
      },
      android: {
        googleServicesFile: "./google-services.json",
      },
      plugins: [
        "@react-native-firebase/app",
        [
          "expo-build-properties",
          {
            ios: {
              useFrameworks: "static",
            },
          },
        ],
      ],
    });
    ```

    <Callout>
      For iOS only, since `firebase-ios-sdk` requires `use_frameworks` you need to configure `expo-build-properties` by adding `"useFrameworks": "static"`.
    </Callout>

    Listing a module in the Config Plugins (the `plugins` array in the config above) is only required for React Native Firebase modules that involve native installation steps - e.g. modifying the Xcode project, `Podfile`, `build.gradle`, `AndroidManifest.xml` etc. React Native Firebase modules without native steps will work out of the box.
  </Step>

  <Step>
    ## Generate native code

    If you are compiling your app locally, you'll need to regenerate the native code for the platforms to pick up the changes:

    ```bash
    npx expo prebuild --clean
    ```

    Then, you could follow the same steps as in the [development environment setup](/docs/mobile/installation/development) guide to run the app locally or [build a production version](/docs/mobile/publishing/checklist#build-your-app) of your app.
  </Step>
</Steps>

Et voilà! You've set up and linked your Firebase project to your mobile app 🎉

You can learn more about the Firebase integration and it's possibilities in the [official documentation](https://rnfirebase.io/).
