---
title: Background service worker
description: Configure your extension's background service worker.
url: /docs/extension/structure/background
---

# Background service worker

An extension's service worker is a powerful script that runs in the background, separate from other parts of the extension. It's loaded when it is needed, and unloaded when it goes dormant.

Once loaded, an extension service worker generally runs as long as it is actively receiving events, though it [can shut down](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#idle-shutdown). Like its web counterpart, an extension service worker cannot access the DOM, though you can use it if needed with [offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

Extension service workers are more than network proxies (as web service workers are often described), they run in a separate [service worker context](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers). For example, when in this context, you no longer need to worry about CORS and can fetch resources from any origin.

In addition to the [standard service worker events](https://developer.mozilla.org/docs/Web/API/ServiceWorkerGlobalScope#events), they also respond to extension events such as navigating to a new page, clicking a notification, or closing a tab. They're also registered and updated differently from web service workers.

**It's common to offload heavy computation to the background service worker**, so you should always try to do resouce-expensive operations there and send results using [Messages API](/docs/extension/structure/messaging) to other parts of the extension.

Code for the background service worker is located at `src/app/background` directory - you need to use `defineBackground` within `index.ts` file inside to allow WXT to include your script in the build.

```ts title="src/app/background/index.ts"
import { defineBackground } from "wxt/sandbox";

const main = () => {
  console.log(
    "Background service worker is running! Edit `src/app/background` and save to reload.",
  );
};

export default defineBackground(main);
```

To see the service worker in action, reload the extension, then open its "Service Worker inspector":

![Service Worker inspector](/images/docs/extension/structure/sw-inspector.png)

You should see what we've logged in the console:

![Service Worker console](/images/docs/extension/structure/sw-log.png)

To communicate with the service worker from other parts of the extension, you can use the [Messaging API](/docs/extension/structure/messaging).

## Persisting state

<Callout>
  Service workers in `dev` mode always remain in `active` state.
</Callout>

The worker becomes idle after a few seconds of inactivity, and the browser will kill its process entirely after 5 minutes. This means all state (variables, etc.) is lost unless you use a storage engine.

The simplest way to persist your background service worker's state is to use the [storage API](/docs/extension/structure/storage).

The more advanced way is to send the state to a remote database via our [backend API](/docs/extension/api/overview).

<Cards>
  <Card title="Using service workers" href="https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers" description="developer.mozilla.org" />

  <Card title="Migrate to a service worker" href="https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers" description="developer.chrome.com" />

  <Card title="Extension service worker basics" href="https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics" description="developer.chrome.com" />

  <Card title="The extension service worker lifecycle" href="https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle" description="developer.chrome.com" />
</Cards>
