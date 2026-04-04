---
title: Tracking events
description: Learn how to track events in your TurboStarter web app.
url: /docs/web/analytics/tracking
---

# Tracking events

The implementation strategy for each analytics provider varies depending on whether it's designed for client-side or server-side use. We'll explore both approaches, as they are crucial for ensuring accurate and comprehensive analytics data in your web SaaS application.

## Client-side tracking

The client strategy for tracking events, which every provider must implement, is straightforward:

```ts
export type AllowedPropertyValues = string | number | boolean;

type TrackFunction = (
  event: string,
  data?: Record<string, AllowedPropertyValues>,
) => void;

export interface AnalyticsProviderClientStrategy {
  Provider: ({ children }: { children: React.ReactNode }) => React.ReactNode;
  track: TrackFunction;
}
```

<Callout>
  You don't need to worry much about this implementation, as all the providers are already configured for you. However, it's useful to be aware of this structure if you plan to add your own custom provider.
</Callout>

As shown above, each provider must supply two key elements:

1. `Provider` - a component that [wraps your app](/docs/web/analytics/configuration#client-side-context).
2. `track` - a function responsible for sending event data to the provider.

To track an event, you simply need to invoke the `track` method, passing the event name and an optional data object:

```tsx
import { track } from "@turbostarter/analytics-web";

export const MyComponent = () => {
  return (
    <button onClick={() => track("button.click", { country: "US" })}>
      Track event
    </button>
  );
};
```

## Identifying users

Linking events to specific users enables you to build a full picture of how they're using your product across different sessions, devices, and platforms.

For identification purposes, the client strategy can also expose `identify` and `reset` methods. They are optional and only needed if you want to identify users in your app and associate their actions with a specific user ID.

Not all analytics providers support user identification (for example, [Vercel Analytics](/docs/web/analytics/configuration#vercel) and [Plausible](/docs/web/analytics/configuration#plausible)), so make sure your chosen provider exposes these methods before using them.

```ts
type IdentifyFunction = (
  userId: string,
  traits?: Record<string, AllowedPropertyValues>,
) => void;

export interface AnalyticsProviderClientStrategy {
  identify: IdentifyFunction;
  reset: () => void;
}
```

To identify users on the client, call the `identify` function, passing the user's ID and an optional traits object:

```tsx
import { identify } from "@turbostarter/analytics-web";

identify("user-123", { name: "John Doe" });
```

This will associate all future events with the user's ID, allowing you to track user behavior and gain valuable insights into your application's usage patterns.

<Callout title="Configured by default!">
  The `identify` method is configured out-of-the-box to react to changes in the user's authentication state.

  When the user is authenticated, the `identify` method will be called with the user's ID and traits. When the user is logged out, the `reset` method will be called to clear the existing user identification.
</Callout>

## Server-side tracking

The server strategy for tracking events that every provider has to implement is even simpler:

```ts
export interface AnalyticsProviderServerStrategy {
  track: TrackFunction;
}
```

<Callout>
  You don't need to worry much about this implementation, as all the providers are already configured for you. However, it's useful to be aware of this structure if you plan to add your own custom provider.
</Callout>

This server-side strategy allows you to track events outside of the browser environment, which is particularly useful for scenarios involving server actions or React Server Components.

To track an event on the server side, simply call the `track` method, providing the event name and an optional data object:

```tsx
// [!code word:server]
import { track } from "@turbostarter/analytics-web/server";

track("button.click", {
  country: "US",
  region: "California",
});
```

<Callout type="error" title="Ensure correct import!">
  Make sure to use the correct import for the `track` function. We're using the same name for both client and server tracking, but they are different functions. For server-side, just add `/server` to the import path (`@turbostarter/analytics-web/server`).

  <Tabs items={["Client-side", "Server-side"]}>
    <Tab value="Client-side">
      ```tsx
      import { track } from "@turbostarter/analytics-web";
      ```
    </Tab>

    <Tab value="Server-side">
      ```tsx
      // [!code word:server]
      import { track } from "@turbostarter/analytics-web/server";
      ```
    </Tab>
  </Tabs>
</Callout>

<Callout title="Identifying users on the server" type="warn">
  On the server, there are no dedicated identification helpers like `identify` or `reset`. Most providers that support user-level tracking expect you to pass an identifier or traits directly within the `track` call (for example, as a `userId` or similar property), so make sure to check your specific provider's documentation for the recommended way to include user information.
</Callout>

Congratulations! You've now mastered event tracking in your TurboStarter web app. With this knowledge, you're well-equipped to analyze user behaviors and gain valuable insights into your application's usage patterns. Happy analyzing! 📊
