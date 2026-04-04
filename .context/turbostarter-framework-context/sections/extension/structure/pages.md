---
title: Pages
description: Get started with your extension's pages.
url: /docs/extension/structure/pages
---

# Pages

Extension pages are built-in pages recognized by the browser. They include the extension's popup, options, sidepanel and newtab pages.

<Callout>
  As WXT is based on Vite, it has very powerful [HMR support](https://vite.dev/guide/features#hot-module-replacement). This means that you don't need to refresh the extension manually when you make changes to the code.
</Callout>

## Popup

The popup page is a small dialog window that opens when a user clicks on the extension's icon in the browser toolbar. It is the most common type of extension page.

![Popup window](/images/docs/extension/structure/popup.png)

<Cards>
  <Card title="Add a popup" href="https://developer.chrome.com/docs/extensions/develop/ui/add-popup" description="developer.chrome.com" />

  <Card title="Entrypoints" href="https://wxt.dev/guide/essentials/entrypoints.html" description="wxt.dev" />
</Cards>

## Options

The options page is meant to be a dedicated place for the extension's settings and configuration.

![Options page](/images/docs/extension/structure/options.png)

<Card title="Give users options" href="https://developer.chrome.com/docs/extensions/develop/ui/options-page" description="developer.chrome.com" />

## Devtools

The devtools page is a custom page (including panels) that opens when a user opens the extension's devtools panel.

![Devtools page](/images/docs/extension/structure/devtools.png)

<Card title="Extend devtools" href="https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools" description="developer.chrome.com" />

## New tab

The new tab page is a custom page that opens when a user opens a new tab in the browser.

![New tab page](/images/docs/extension/structure/newtab.png)

<Card title="Override Chrome pages" href="https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages" description="developer.chrome.com" />

## Side panel

The side panel is a custom page that opens when a user clicks on the extension's icon in the browser toolbar.

![Side panel](/images/docs/extension/structure/sidepanel.png)

<Card title="Side panel" href="https://developer.chrome.com/docs/extensions/reference/api/sidePanel" description="developer.chrome.com" />

## Tabs

Unlike traditional extension pages, tab (unlisted) pages are just regular web pages shipped with your extension bundle. Extensions generally redirect to or open these pages programmatically, but you can link to them as well.

They could be useful for following cases:

* when you want to show a some page when user first installs your extension
* when you want to have dedicated pages for authentication
* when you need more advanced routing setup

![Tab page](/images/docs/extension/structure/tabs.png)

Your tab page will be available under the `/tabs` path in the extension bundle. It will be accessible from the browser under the URL:

```
chrome-extension://<your-extension-id>/tabs/your-tab-page.html
```

<Card title="Unlisted pages" href="https://wxt.dev/guide/essentials/entrypoints.html#unlisted-pages" description="wxt.dev" />
