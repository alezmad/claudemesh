---
title: Apple
description: Configure "Sign in with Apple" for your mobile application.
url: /docs/mobile/auth/oauth/apple
---

# Apple

**"Sign in with Apple"** provides a native, privacy-preserving SSO experience on iOS. Use the system Apple button and the Apple Authentication APIs to sign users in, then verify the identity token on your backend and create a session with your auth server.

<Callout title="Apple ID authentication is available on iOS only">
  Native Apple ID authentication is available on iOS only. You are advised to
  present the official system button (or our custom component - also compliant!)
  and follow [Apple's Human Interface
  Guidelines](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)
  for best practices.
</Callout>

![Sign in with Apple](/images/docs/mobile/auth/sign-in-with-apple.png)

## Why use native Apple ID authentication?

<Cards>
  <Card title="First-class native UX">
    System sheet + official button, aligned with [Apple's Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple) for trust and conversion.
  </Card>

  <Card title="Privacy-forward">
    Private relay email and limited data by design, ensuring your users' privacy is protected and compliant with App Store guidelines.
  </Card>

  <Card title="Fewer passwords">
    Fast, low-friction sign-in on iOS enabling your users to sign in without the need to remember or create additional passwords.
  </Card>

  <Card title="Secure by default">
    JWT verification on the server with [Better Auth](https://www.better-auth.com/docs/authentication/apple), keeping your users' credentials secure.
  </Card>

  <Card title="Seamless sessions">
    We exchange Apple credentials for an app session and persist it in the app.
  </Card>
</Cards>

## Requirements

* Enable the "Sign in with Apple" capability for your bundle identifier in the [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list)
* Add the entitlement and build with [EAS](/docs/mobile/publishing/checklist) (or configure natively)
* Ensure your app's deep link scheme is added to the auth server's [trusted origins configuration](/docs/mobile/auth/configuration)

Check the [Better Auth documentation](https://www.better-auth.com/docs/authentication/apple) for more details on how to configure all the required keys and certificates.

## High-level flow

1. Check availability with `AppleAuthentication.isAvailableAsync()`.
2. Render the system `AppleAuthenticationButton` or custom TurboStarter component.
3. Call `AppleAuthentication.signInAsync()` requesting `FULL_NAME` and/or `EMAIL` as needed.
4. Send the returned `idTokeb` identifier to the API powered by [Better Auth](https://www.better-auth.com/docs/authentication/apple) to verify and establish a session.
5. Optionally track credential state with `AppleAuthentication.getCredentialStateAsync(user)`.

<Callout type="warn" title="Verify on the server">
  Always verify the JWT signature from `idToken` on your backend using Apple's
  public keys before creating a session.
</Callout>

For a more in-depth overview of Apple ID authentication—including implementation details, platform caveats, and advanced configuration—see the following resources:

<Cards>
  <Card title="Expo AppleAuthentication" href="https://docs.expo.dev/versions/latest/sdk/apple-authentication/" description="docs.expo.dev" />

  <Card title="Login with Apple" href="https://www.better-auth.com/docs/authentication/apple" description="better-auth.com" />

  <Card title="Sign in with Apple" href="https://developer.apple.com/documentation/sign_in_with_apple" description="developer.apple.com" />
</Cards>
