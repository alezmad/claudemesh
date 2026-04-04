---
title: Using API client
description: How to use API client to interact with the API.
url: /docs/mobile/api/client
---

# Using API client

In mobile app code, you can only access the API client from the **client-side.**

When you create a new component or screen and want to fetch some data, you can use the API client to do so.

## Creating a client

We're creating a client-side API client in `apps/mobile/src/lib/api/index.tsx` file. It's a simple wrapper around the [@tanstack/react-query](https://tanstack.com/query/latest/docs/framework/react/overview) that fetches or mutates data from the API.

It also requires wrapping your app in a `QueryClientProvider` component to provide the API client to the rest of the app:

```tsx title="_layout.tsx"
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryClientProvider>
      <SafeAreaProvider>
        <Stack>
          ...
          <Stack.Screen name="index" />
          ...
        </Stack>
        <StatusBar barStyle="light-content" />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
```

<Callout type="warn" title="Ensure correct API url">
  Inside the `apps/mobile/src/lib/api/utils.ts` file we're calling a function to get base url of your api, so make sure it's set correctly (especially on production) and your web api endpoint is corresponding with the name there.

  ```tsx title="utils.ts"
  const getBaseUrl = () => {
    /**
     * Gets the IP address of your host-machine. If it cannot automatically find it,
     * you'll have to manually set it. NOTE: Port 3000 should work for most but confirm
     * you don't have anything else running on it, or you'd have to change it.
     *
     * **NOTE**: This is only for development. In production, you'll want to set the
     * baseUrl to your production API URL.
     */
    const debuggerHost = Constants.expoConfig?.hostUri;
    const localhost = debuggerHost?.split(":")[0];

    if (!localhost) {
      console.warn("Failed to get localhost. Pointing to production server...");
      return env.EXPO_PUBLIC_SITE_URL;
    }
    return `http://${localhost}:3000`;
  };
  ```

  As you can see we're relying on your machine IP address for local development (in case you want to open the app from another device) or on the [environment variables](/docs/mobile/configuration/environment-variables) in production to get it, so there shouldn't be any issues with it, but in case, please be aware where to find it 😉
</Callout>

## Queries

Of course, everything comes already configured for you, so you just need to start using `api` in your components/screens.

For example, to fetch the list of posts you can use the `useQuery` hook:

```tsx title="app/(tabs)/tab-one.tsx"
import { api } from "~/lib/api";

export default function TabOneScreen() {
  const { data: posts, isLoading } = useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      const response = await api.posts.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch posts!");
      }

      return response.json();
    },
  });

  if (isLoading) {
    return <Text>Loading...</Text>;
  }

  /* do something with the data... */
  return (
    <View>
      <Text>{JSON.stringify(posts)}</Text>
    </View>
  );
}
```

It's using the `@tanstack/react-query` [useQuery API](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery), so you shouldn't have any troubles with it.

<Cards>
  <Card title="Hono RPC" description="hono.dev" href="https://hono.dev/docs/guides/rpc" />

  <Card title="useQuery hook | Tanstack Query" description="tanstack.com" href="https://tanstack.com/query/latest/docs/framework/react/reference/useQuery" />
</Cards>

## Mutations

If you want to perform a mutation in your mobile code, you can use the `useMutation` hook that comes straight from the integration with [Tanstack Query](https://tanstack.com/query):

```tsx title="form.tsx"
import { api } from "~/lib/api";

export function CreatePost() {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: async (post: PostInput) => {
      const response = await api.posts.$post(post);

      if (!response.ok) {
        throw new Error("Failed to create post!");
      },
    },
    onSuccess: () => {
      toast.success("Post created successfully!");
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });

  return (
    <Form>
      <Button onPress={onSubmit(mutate)}>Submit</Button>
    </Form>
  );
}
```

Here, we're also invalidating the query after the mutation is successful. This is a very important step to make sure that the data is updated in the UI.

<Cards>
  <Card title="useMutation hook" description="tanstack.com" href="https://tanstack.com/query/latest/docs/framework/react/reference/useMutation" />

  <Card title="Query invalidation" description="tanstack.com" href="https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation" />
</Cards>

## Handling responses

As you can see in the examples above, the [Hono RPC](https://hono.dev/docs/guides/rpc) client returns a plain `Response` object, which you can use to get the data or handle errors. However, implementing this handling in every query or mutation can be tedious and will introduce unnecessary boilerplate in your codebase.

That's why we've developed the `handle` function that unwraps the response for you, handles errors, and returns the data in a consistent format. You can safely use it with any procedure from the API client:

<Tabs items={["Queries", "Mutations"]}>
  <Tab value="Queries">
    ```tsx
    // [!code word:handle]
    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api";

    export default function TabOneScreen() {
      const { data: posts, isLoading } = useQuery({
        queryKey: ["posts"],
        queryFn: handle(api.posts.$get),
      });

      if (isLoading) {
        return <Text>Loading...</Text>;
      }

      /* do something with the data... */
      return (
        <View>
          <Text>{JSON.stringify(posts)}</Text>
        </View>
      );
    }
    ```
  </Tab>

  <Tab value="Mutations">
    ```tsx
    // [!code word:handle]
    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/client";

    export default function CreatePost() {
      const queryClient = useQueryClient();
      const { mutate } = useMutation({
        mutationFn: handle(api.posts.$post),
        onSuccess: () => {
          toast.success("Post created successfully!");
          queryClient.invalidateQueries({ queryKey: ["posts"] });
        },
      });

      return (
        <Form>
          <Button onPress={onSubmit(mutate)}>Submit</Button>
        </Form>
      );
    }
    ```
  </Tab>
</Tabs>

With this approach, you can focus on the business logic instead of repeatedly writing code to handle API responses in your browser extension components, making your extension's codebase more readable and maintainable.

The same error handling and response unwrapping benefits apply whether you're building web, mobile, or extension interfaces - allowing you to keep your data fetching logic consistent across all platforms.
