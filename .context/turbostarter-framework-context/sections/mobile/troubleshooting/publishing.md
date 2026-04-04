---
title: Publishing
description: Find answers to common mobile publishing issues.
url: /docs/mobile/troubleshooting/publishing
---

# Publishing

## My app submission was rejected

If your app submission was rejected, you probably got an email with the reason. You'll need to fix the issues and upload a new build of your app to the store and send it for review again.

Make sure to follow the [guidelines](/docs/mobile/marketing) when submitting your app to ensure that everything is setup correctly.

## App Store screenshots don't match requirements

If your app submission was rejected due to screenshot issues, make sure:

1. Screenshots match the required dimensions for each device
2. Screenshots accurately represent your app's functionality
3. You have provided screenshots for all required device sizes
4. Screenshots don't contain device frames unless they match Apple's requirements

[See Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)

## Version number conflicts

If you get version number conflicts when submitting:

1. Ensure your `app.json` version matches what's in the store
2. Increment the version number appropriately:
   ```bash
   "version": "1.0.1",
   "android.versionCode": 2,
   "ios.buildNumber": "2"
   ```
3. Make sure both stores have unique version numbers

## Missing or incorrect environment variables

If your build succeeds but the binary is misconfigured (e.g., API URL shows as `undefined`, Sentry auth fails, or `app.config.*` settings don’t apply), verify your EAS environment variables:

1. Define variables on EAS and assign them to the correct environment (`development`, `preview`, `production`).
2. For values used in app code, prefix with `EXPO_PUBLIC_` and read via `process.env.EXPO_PUBLIC_...`.
3. For config-time values (bundle identifiers, file paths), read `process.env.VARNAME` from your `app.config.*`.
4. Explicitly set `environment` in `eas.json` build profiles, or pass `--environment` to `eas update` so updates use the same variables as builds.
5. For local development, pull variables into a `.env` file:
   ```bash
   eas env:pull --environment development
   ```
6. Use secret file variables (e.g., `GOOGLE_SERVICES_JSON`) and reference them in `app.config.*`.
7. Keep `.env` out of git; cloud builds don’t rely on your local `.env`.

See: [Environment variables in EAS](https://docs.expo.dev/eas/environment-variables/).

## My app crashes on production build

If the app works in development but crashes in a production build, check these common causes:

1. **Missing or incorrect environment variables at build time**. EAS cloud jobs don’t use your local `.env` by default. Ensure variables exist on EAS, are assigned to the correct environment, and use `EXPO_PUBLIC_` for values read in app code. See: [Environment variables in EAS](https://docs.expo.dev/eas/environment-variables/).
2. **Missing native config files**. Provide `google-services.json` / `GoogleService-Info.plist` via secret file variables (e.g., `GOOGLE_SERVICES_JSON`) and reference them in `app.config.*`.
3. **Production-only code paths**. Guard dev-only code with `__DEV__`, avoid importing dev tools in production, and ensure feature flags don’t access undefined values.
4. **Misconfigured native modules or plugins**. Verify required plugins/babel config are present and rebuild after cache clears.

Try this:

1. Run the app with a production JS bundle locally to surface minification issues:
   ```bash
   npx expo start --no-dev --minify
   ```
2. Inspect device logs when the crash occurs (Android: `adb logcat`, iOS: Console.app or Xcode Devices).
3. Rebuild with a clean cache if needed:
   ```bash
   eas build --clear-cache
   ```
