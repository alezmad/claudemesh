---
title: Messaging
description: Communicate between your extension's components.
url: /docs/extension/structure/messaging
---

# Messaging

Messaging API makes communication between different parts of your extension easy. To make it simple and scalable, we're leveraging `@webext-core/messaging` library.

It provides a declarative, type-safe, functional, promise-based API for sending, relaying, and receiving messages between your extension components.

## Handling messages

Based on our convention, we implemented a little abstraction on top of `@webext-core/messaging` to make it easier to use. That's why all types and keys are stored inside `lib/messaging` directory:

```ts title="lib/messaging/index.ts"
import { defineExtensionMessaging } from "@webext-core/messaging";

export const Message = {
  HELLO: "hello",
} as const;

export type Message = (typeof Message)[keyof typeof Message];

interface Messages {
  [Message.HELLO]: (message: string) => string;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<Messages>();
```

There you need to define what will be handled under each key. To make it more secure, only `Message` enum and `onMessage` and `sendMessage` functions are exported from the module.

All message handlers are located in `src/app/background/messaging` directory under respective subdirectories.

To create a message handler, create a TypeScript module in the `background/messaging` directory. Then, include your handlers for all keys related to the message:

```ts title="app/background/messaging/hello.ts"
import { onMessage, Message } from "~/lib/messaging";

onMessage(Message.HELLO, (req) => {
  const result = await querySomeApi(req.body.id);

  return result;
});
```

<Callout title="Don't forget to import!" type="warn">
  To make your handlers available across your extension, you need to import them
  in the `background/index.ts` file. That way they could be interpreted by the
  build process facilitated by WXT.
</Callout>

## Sending messages

Extension pages, content scripts, or tab pages can send messages to the handlers using the `sendMessage` function. Since we orchestrate your handlers behind the scenes, the message names are typed and will enable autocompletion in your editor:

```tsx title="app/popup/index.tsx"
import { sendMessage, Message } from "~/lib/messaging";

...

const response = await sendMessage(Message.HELLO, "Hello, world!");

console.log(response);

...
```

As it's an asynchronous operation, it's advisable to use [@tanstack/react-query](https://tanstack.com/query/latest/docs/framework/react/overview) integration to handle the response on the client side.

We're already doing it that way when fetching auth session in the `User` component:

```tsx title="hello.tsx"
export const Hello = () => {
  const { data, isLoading } = useQuery({
    queryKey: [Message.HELLO],
    queryFn: () => sendMessage(Message.HELLO, "Hello, world!"),
  });

  if (isLoading) {
    return <p>Loading...</p>;
  }

  /* do something with the data... */
  return <p>{data?.message}</p>;
};
```

<Cards>
  <Card href="https://webext-core.aklinker1.io/messaging/installation/" title="Messaging API" description="webext-core.aklinker1.io" />

  <Card title="Message passing" description="developer.chrome.com" href="https://developer.chrome.com/docs/extensions/develop/concepts/messaging" />
</Cards>
