---
title: Overview
description: Learn about the structure of the extension app.
url: /docs/extension/structure/overview
---

# Overview

Every browser extension is different and can include different parts, removing the ones that are not needed.

TurboStarter ships with all the things you need to start developing your own extension including:

* **Popup window** - a small window that appears when the user clicks the extension icon.
* **Options page** - a page that appears when user enters extension settings.
* **Side panel** - a panel that appears when the user clicks sidepanel.
* **New tab page** - a page that appears when the user opens a new tab.
* **Devtools page** - a page that appears when the user opens the browser's devtools.
* **Tab pages** - custom pages shipped with the extension.
* **Content scripts** - injected scripts that run in the browser page.
* **Background scripts** - scripts that run in the background.
* **Message passing** - a way to communicate between different parts of the extension.
* **Storage** - a way to store data in the extension.

All the entrypoints are defined in `apps/extension/src/app` directory (it's similar to file-based routing in Next.js and Expo).

This directory acts as a source for WXT framework which is used to build the extension. It has the following structure:

<Files>
  <Folder name="app" defaultOpen>
    <Folder name="background - Background service worker" />

    <Folder name="content - Content scripts" />

    <Folder name="devtools - Devtools page with custom panels" />

    <Folder name="newtab - New tab page" />

    <Folder name="options - Options page" />

    <Folder name="popup - Popup window" />

    <Folder name="sidepanel - Side panel" />

    <Folder name="tabs - Custom pages shipped with the extension" />
  </Folder>
</Files>

By structurizing it this way, we can easily add new entrypoints in the future and extend rest of the extension independently from each other.

We'll go through each part and explain the purpose of it, check following sections for more details:
