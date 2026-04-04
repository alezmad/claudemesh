---
title: Installation
description: Find answers to common mobile installation issues.
url: /docs/mobile/troubleshooting/installation
---

# Installation

## Cannot clone the repository

Issues related to cloning the repository are usually related to a Git misconfiguration in your local machine. The commands displayed in this guide using SSH: these will work only if you have setup your SSH keys in Github.

If you run into issues, [please make sure you follow this guide to set up your SSH key in Github.](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)

If this also fails, please use HTTPS instead. You will be able to see the commands in the repository's Github page under the "Clone" dropdown.

Please also make sure that the account that accepted the invite to TurboStarter, and the locally connected account are the same.

## Local database doesn't start

If you cannot run the local database container, it's likely you have not started [Docker](https://docs.docker.com/get-docker/) locally. Our local database requires Docker to be installed and running.

Please make sure you have installed Docker (or compatible software such as [Colima](https://github.com/abiosoft/colima), [Orbstack](https://github.com/orbstack/orbstack)) and that is running on your local machine.

Also, make sure that you have enough [memory and CPU allocated](https://docs.docker.com/engine/containers/resource_constraints/) to your Docker instance.

## I don't see my translations

If you don't see your translations appearing in the application, there are a few common causes:

1. Check that your translation `.json` files are properly formatted and located in the correct directory
2. Verify that the language codes in your configuration match your translation files
3. Enable debug mode (`debug: true`) in your i18next configuration to see detailed logs

[Read more about configuration for translations](/docs/mobile/internationalization#configuration)

## Expo cannot detect XCode

If you get the following error:

```bash
Expo cannot detect Xcode Xcode must be fully installed before you can continue
```

This is usually related to the Xcode CLI not being installed. You can fix this by running the following command:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

If you still face the issue, please make sure you have the latest version of Xcode installed.

## "Module not found" error

This issue is mostly related to either dependency installed in the wrong package or issues with the file system.

The most common cause is incorrect dependency installation. Here's how to fix it:

1. Clean the workspace:

   ```bash
   pnpm clean
   ```

2. Reinstall the dependencies:
   ```bash
   pnpm i
   ```

If you're adding new dependencies, make sure to install them in the correct package:

```bash
# For main app dependencies
pnpm install --filter mobile my-package

# For a specific package
pnpm install --filter @turbostarter/ui my-package
```

If the issue persists, please check the file system for any issues.

### Windows OneDrive

OneDrive can cause file system issues with Node.js projects due to its file syncing behavior. If you're using Windows with OneDrive, you have two options to resolve this:

1. Move your project to a location outside of OneDrive-synced folders (recommended)
2. Disable OneDrive sync specifically for your development folder

This prevents file watching and symlink issues that can occur when OneDrive tries to sync Node.js project files.
