---
title: AI
description: Learn how to use AI integration in your mobile app.
url: /docs/mobile/ai
---

# AI

As AI integration for [web](/docs/web/ai/overview), [extension](/docs/extension/ai), and mobile is based on the same battle-tested [Vercel AI SDK](https://sdk.vercel.ai/docs/introduction), the implementation is very similar across platforms.

In this section, we'll focus on how to consume AI responses in the mobile app. For server-side implementation details, please refer to the [web documentation](/docs/web/ai/overview).

## Features

The most common AI integration features are also supported in the mobile app:

* **Chat**: Build chat interfaces inside native mobile apps.
* **Streaming**: Receive AI responses as soon as the model starts generating them, without waiting for the full response to be completed.
* **Image generation**: Generate images based on a given prompt.

You can easily compose your application using these building blocks or extend them to suit your specific needs.

## Usage

The usage of AI integration in the mobile app is the same as for [web app](/docs/web/ai/configuration#client-side) and [browser extension](/docs/extension/ai#server--client). We use the exact same [API endpoint](/docs/web/ai/configuration#api-endpoint), and since TurboStarter ships with built-in support for streaming on mobile, we can leverage it to display answers incrementally to the user as they're generated.

```tsx title="ai.tsx"
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const AI = () => {
  const { messages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
    }),
  });

  return (
    <View>
      {messages.map((message) => (
        <Text key={message.id}>
          {message.parts.map((part, i) => {
            switch (part.type) {
              case "text":
                return <Text key={`${message.id}-${i}`}>{part.text}</Text>;
            }
          })}
        </Text>
      ))}
    </View>
  );
};

export default AI;
```

By leveraging this integration, we can easily manage the state of the AI request and update the UI as soon as the response is ready.

TurboStarter ships with a ready-to-use implementation of AI chat, allowing you to see this solution in action. Feel free to reuse or modify it according to your needs.
