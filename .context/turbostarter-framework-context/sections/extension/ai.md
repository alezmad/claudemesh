---
title: AI
description: Leverage AI in your TurboStarter extension.
url: /docs/extension/ai
---

# AI

When it comes to AI within the browser extension, we can differentiate two approaches:

* **Server + client**: Traditional implementation, same as for [web](/docs/web/ai/overview) and [mobile](/docs/mobile/ai), used to stream responses generated on the server to the client.
* **Chrome built-in AI**: An [experimental implementation](https://developer.chrome.com/docs/ai/built-in) of [Gemini Nano](https://blog.google/technology/ai/google-gemini-ai/#performance) that's built into new versions of the Google Chrome browser.

We recommend relying more on the traditional server + client approach, as it's more versatile and easier to implement. Chrome's built-in AI is a nice feature, but it's still experimental and has some limitations.

Of course, you can always implement a *hybrid* approach which combines both solutions to achieve the best results.

## Server + client

The traditional usage of AI integration in the browser extension is the same as for [web app](/docs/web/ai/configuration#client-side) and [mobile app](/docs/mobile/ai). We use the exact same [API endpoint](/docs/web/ai/configuration#api-endpoint), and we leverage streaming to display answers incrementally to the user as they're generated.

```tsx title="main.tsx"
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const Popup = () => {
  const { messages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
    }),
  });

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          {message.parts.map((part, i) => {
            switch (part.type) {
              case "text":
                return <div key={`${message.id}-${i}`}>{part.text}</div>;
            }
          })}
        </div>
      ))}
    </div>
  );
};

export default Popup;
```

It's the most reliable and recommended way to use AI in the browser extension. Feel free to reuse or modify it to suit your specific needs.

## Chrome built-in AI

<Callout type="warn">
  Chrome's implementation of [built-in AI with Gemini Nano](https://developer.chrome.com/docs/ai/built-in) is experimental and will change as they test and address feedback.
</Callout>

Chrome's built-in AI is a preview feature. To use it, you need Chrome version 127 or greater and you must enable these flags:

* [chrome://flags/#prompt-api-for-gemini-nano](chrome://flags/#prompt-api-for-gemini-nano): `Enabled`
* [chrome://flags/#optimization-guide-on-device-model](chrome://flags/#optimization-guide-on-device-model): `Enabled BypassPrefRequirement`
* [chrome://components/](chrome://components/): Click `Optimization Guide On Device Model` to download the model.

Once enabled, you'll be able to use `window.ai` to access the built-in AI and do things like this:

![Chrome built-in AI](/images/docs/extension/ai.gif)

You can even use a [dedicated provider](https://sdk.vercel.ai/providers/community-providers/chrome-ai) from the Vercel AI SDK ecosystem to simplify its usage. Please remember that this API is still in its early stages and might change in the future.

<Callout title="Available in every extension context!">
  The best thing is that you can use this API in every part of your extension, e.g., popup, background service worker, etc.

  It's completely safe to use on the client-side, as we're not exposing any sensitive data to the user (such as the API key in the traditional server + client approach).
</Callout>

To learn more, please check out the official [Chrome documentation](https://developer.chrome.com/docs/ai/built-in) and the articles listed below.

<Cards>
  <Card href="https://developer.chrome.com/docs/ai/built-in" title="Get started with built-in AI" description="developer.chrome.com" />

  <Card href="https://developer.chrome.com/docs/extensions/ai" title="Extensions and AI" description="developer.chrome.com" />
</Cards>
