---
title: Updates
description: Learn how to update your published extension.
url: /docs/extension/publishing/updates
---

# Updates

After publishing your extension to the stores, you can release updates to deliver new features and bug fixes to your users.

TurboStarter provides a ready-to-use process for updating your extensions. Let's quickly review how it works.

## Uploading a new version

The recommended way to update your extension is to submit a new version to the stores. This method is the most reliable, although it may take some time for the new version to be approved and become available to users.

To submit a new version, simply update the version number in your `package.json` file:

```json title="package.json"
{
    ...
    "version": "1.0.0", // [!code --]
    "version": "1.0.1", // [!code ++]
    ...
}
```

Next, follow the exact same steps as [when you initially published your extension](/docs/extension/publishing/checklist). When submitting your extension for review, be sure to provide release notes describing the new version.
