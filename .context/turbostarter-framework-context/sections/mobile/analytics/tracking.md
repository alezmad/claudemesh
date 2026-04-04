---
title: Tracking events
description: Learn how to track events in your TurboStarter mobile app.
url: /docs/mobile/analytics/tracking
---

# Tracking events

The strategy for tracking events that every provider has to implement is extremely simple:

```ts
export type AllowedPropertyValues = string | number | boolean;

type TrackFunction = (
  event: string,
  data?: Record<string, AllowedPropertyValues>,
) => void;

export interface AnalyticsProviderStrategy {
  Provider: ({ children }: { children: React.ReactNode }) => React.ReactNode;
  track: TrackFunction;
}
```

<Callout>
  You don't need to worry much about this implementation, as all the providers are already configured for you. However, it's useful to be aware of this structure if you plan to add your own custom provider.
</Callout>

As shown above, each provider must supply two key elements:

1. `Provider` - a component that [wraps your app](/docs/mobile/analytics/configuration#context).
2. `track` - a function responsible for sending event data to the provider.

To track an event, you simply need to invoke the `track` method, passing the event name and an optional data object:

```tsx
import { track } from "@turbostarter/analytics-mobile";

export const MyComponent = () => {
  return (
    <Pressable onPress={() => track("button.click", { country: "US" })}>
      Track event
    </Pressable>
  );
};
```

In most mobile apps, you'll only ever need to use the `track` method to track events. You can use it anywhere in your app code—such as in response to user interactions, navigation events, or custom actions - by simply calling `track` with an event name and optional properties.

## Identifying users

Linking events to specific users enables you to build a full picture of how they're using your product across different sessions, devices, and platforms.

For identification purposes, we're extending the strategy with the `identify` and `reset` methods. They are optional and only needed if you want to identify users in your app and associate their actions with a specific user ID.

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

To identify users, call the `identify` method, passing the user's ID and an optional traits object:

```tsx
import { identify } from "@turbostarter/analytics-mobile";

identify("user-123", { name: "John Doe" });
```

This will associate all future events with the user's ID, allowing you to track user behavior and gain valuable insights into your application's usage patterns.

<Callout title="Configured by default!">
  The `identify` method is configured out-of-the-box to react on changes to the user's authentication state.

  When the user is authenticated, the `identify` method will be called with the user's ID and the user's traits. When the user is logged out, the `reset` method will be called to clear the existing user identification.
</Callout>

Congratulations! You've now mastered event tracking in your TurboStarter mobile app. With this knowledge, you're well-equipped to analyze user behaviors and gain valuable insights into your application's usage patterns. Happy analyzing!
