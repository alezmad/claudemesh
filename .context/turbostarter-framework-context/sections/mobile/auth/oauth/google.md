---
title: Google
description: Configure "Sign in with Google" for your mobile application.
url: /docs/mobile/auth/oauth/google
---

# Google

**"Sign in with Google"** enables a fast account-chooser experience on mobile (especially on Android). Configure your platform credentials, prompt the native account picker, then exchange the returned token on your backend to create a session with your auth server.

<Callout title="Platform support">
  On Android, Google Sign‑In uses [Google Identity
  Services](https://developers.google.com/identity?hl=pl) and integrates with
  the system account chooser. On iOS, the recommended Expo flow uses
  [expo-auth-session](https://docs.expo.dev/versions/latest/sdk/auth-session/)
  with Google for a native, web-based sign-in experience.
</Callout>

![Sign in with Google](/images/docs/mobile/auth/sign-in-with-google.png)

## Why use Google authentication?

<Cards>
  <Card title="First-class native UX">
    Account picker and token storage integrated with the OS for speed and familiarity.
  </Card>

  <Card title="Seamless across platforms">
    Android native chooser; iOS polished experience via Expo.
  </Card>

  <Card title="Secure by default">
    Tokens are verified server-side with [Better Auth](https://www.better-auth.com/docs/authentication/google) before a session is issued.
  </Card>

  <Card title="Faster onboarding">
    Reduce friction with one-tap sign-in and fewer passwords to remember.
  </Card>

  <Card title="Scalable">
    Built on [Google Identity Services](https://developers.google.com/identity?hl=pl) and best-practice OAuth flows.
  </Card>
</Cards>

## Requirements

* Configure [Google Cloud OAuth Client IDs](https://react-native-google-signin.github.io/docs/setting-up/get-config-file) (Android package + SHA-1, iOS bundle ID) in the [Google Cloud Console](https://console.cloud.google.com/)
* Build with [EAS](/docs/mobile/publishing/checklist) to ensure native credentials are embedded correctly
* Add your app deep link scheme to the auth server's [trusted origins configuration](/docs/mobile/auth/configuration)

Check the [Better Auth documentation](https://www.better-auth.com/docs/authentication/google) and [`@react-native-google-signin/google-signin` documentation](https://react-native-google-signin.github.io) for steps to configure your server verification, client IDs and more.

## High-level flow

1. Configure Google OAuth Client IDs for Android and iOS in [Google Cloud Console](https://console.cloud.google.com/).
2. Initialize the Google auth request in your app and render a "Sign in with Google" button.
3. Prompt the account chooser; on success you receive an `idToken` and/or `accessToken`.
4. Send the tokens to the API powered by [Better Auth](https://www.better-auth.com/docs/authentication/google) to verify and establish a session.
5. Persist the session and proceed to the app.

For a more in-depth overview of Google authentication, including implementation details, platform caveats, and advanced configuration, see the following resources:

<Cards>
  <Card title="Use Google Authentication" href="https://docs.expo.dev/guides/google-authentication/" description="docs.expo.dev" />

  <Card title="Login with Google" href="https://www.better-auth.com/docs/authentication/google" description="better-auth.com" />

  <Card title="React Native Google Sign In" href="https://react-native-google-signin.github.io/" description="react-native-google-signin.github.io" />

  <Card title="Authenticate users with Sign in with Google" href="https://developer.android.com/identity/sign-in/credential-manager-siwg" description="developer.android.com" />
</Cards>
