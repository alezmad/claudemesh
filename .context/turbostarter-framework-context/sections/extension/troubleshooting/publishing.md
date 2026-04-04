---
title: Publishing
description: Find answers to common publishing issues.
url: /docs/extension/troubleshooting/publishing
---

# Publishing

## My extension submission was rejected

If your extension submission was rejected, you probably got an email with the reason. You'll need to fix the issues and upload a new build of your extension to the store and send it for review again.

Make sure to follow the [guidelines](/docs/extension/marketing) when submitting your extension to ensure that everything is setup correctly.

## Version number mismatch

If you get version number conflicts when submitting:

1. Ensure your `manifest.json` version matches what's in the store
2. Increment the version number appropriately for each new submission
3. Make sure the version follows semantic versioning (e.g., `1.0.1`)

## Missing permissions in manifest

If your extension is rejected due to permission issues:

1. Review the permissions declared in your `manifest.json`
2. Ensure all permissions are properly justified in your submission
3. Remove any unused permissions that aren't essential
4. Consider using optional permissions where possible

[Learn more about permissions](/docs/extension/configuration/manifest#permissions)

## Content Security Policy (CSP) violations

If your extension is rejected due to CSP issues:

1. Check your manifest's `content_security_policy` field
2. Ensure all external resources are properly whitelisted
3. Remove any unsafe inline scripts or eval usage
4. Use more secure alternatives like `browser.scripting.executeScript`

## My extension crashes on production build

If the extension works during development but crashes after publishing or when loaded unpacked in production mode, check these common causes:

1. **Uncaught runtime errors** in the background service worker or content scripts. Open `chrome://extensions` (or `about:debugging` in Firefox) → enable Developer mode → Inspect the service worker/content script and check the console for stack traces.
2. **Missing permissions or host permissions** causing APIs to throw (e.g., network calls, tabs access). Ensure required `permissions` and `host_permissions` are declared in `manifest.json`.
3. **CSP blocking resources** (inline scripts/styles, remote fonts, or endpoints). Verify `content_security_policy` and update code to avoid unsafe patterns.
4. **Missing assets or incorrect paths** referenced in `manifest.json` (`icons`, `web_accessible_resources`, `action.default_popup`, etc.). Confirm files exist in the final build output and paths match.
5. **Build-time variables not resolved**. If you rely on environment variables, ensure they’re inlined at build time or have safe fallbacks at runtime. Example:
   ```js
   const apiUrl = env.VITE_SITE_URL ?? "https://api.example.com";
   ```
6. **Module format or bundler config issues** (MV3 service worker must be ESM if `type: 'module'`). Align bundler output with your manifest expectations and rebuild.

Try this:

1. Reproduce with a production bundle locally and load it as an unpacked extension; inspect background and content script logs for errors.
2. Validate `manifest.json` and ensure all referenced files are present in the build output.
3. Temporarily relax CSP locally to confirm whether CSP is the cause; then apply a compliant fix (don’t ship relaxed CSP).
4. Add fallbacks for any build-time variables and rebuild.
