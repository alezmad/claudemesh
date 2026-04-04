---
title: Using API client
description: How to use API client to interact with the API.
url: /docs/extension/api/client
---

# Using API client

In browser extension code, you can only access the API client from the **client-side.**

When you create a new component or piece of your extension and want to fetch some data, you can use the API client to do so.

## Creating a client

We're creating a client-side API client in `apps/extension/src/lib/api/index.tsx` file. It's a simple wrapper around the [@tanstack/react-query](https://tanstack.com/query/latest/docs/framework/react/overview) that fetches or mutates data from the API.

It also requires wrapping your views in a `QueryClientProvider` component to provide the API client to the rest of the components.

We recommend to create a separate layout file, which will be used to wrap your pages. TurboStarter comes with a `layout.tsx` file in the `modules/common/layout` folder, which you can use as a template:

```tsx title="layout.tsx"
export const Layout = ({
  children,
  loadingFallback,
  errorFallback,
}: LayoutProps) => {
  return (
    <ErrorBoundary fallback={errorFallback}>
      <Suspense fallback={loadingFallback}>
        <QueryClientProvider>{children}</QueryClientProvider>
      </Suspense>
    </ErrorBoundary>
  );
};
```

Remember that every part of your extension will be mounted as a **separate** React component, so you need to wrap each of them in the `QueryClientProvider` component if you want to use the API client inside:

```tsx title="app/popup/main.tsx"
import { Layout } from "~/modules/common/layout/layout";

export default function Popup() {
  return <Layout>{/* your popup code here */}</Layout>;
}
```

<Callout type="warn" title="Ensure correct API url">
  Inside the `apps/extension/src/lib/api/index.tsx` we're calling a function to get base url of your api, so make sure it's set correctly (especially on production) and your web api endpoint is corresponding with the name there.

  ```tsx title="index.tsx"
  const getBaseUrl = () => {
    return env.VITE_SITE_URL;
  };
  ```

  As you can see we're mostly relying on the [environment variables](/docs/extension/configuration/environment-variables) to get it, so there shouldn't be any issues with it, but in case, please be aware where to find it 😉
</Callout>

## Queries

Of course, everything comes already configured for you, so you just need to start using `api` in your components/screens.

For example, to fetch the list of posts you can use the `useQuery` hook:

```tsx title="posts.tsx"
import { api } from "~/lib/api";

export const Posts = () => {
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
    return <p>Loading...</p>;
  }

  /* do something with the data... */
  return (
    <div>
      <p>{JSON.stringify(posts)}</p>
    </div>
  );
};
```

It's using the `@tanstack/react-query` [useQuery API](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery), so you shouldn't have any troubles with it.

<Cards>
  <Card title="Hono RPC" description="hono.dev" href="https://hono.dev/docs/guides/rpc" />

  <Card title="useQuery hook | Tanstack Query" description="tanstack.com" href="https://tanstack.com/query/latest/docs/framework/react/reference/useQuery" />
</Cards>

## Mutations

If you want to perform a mutation in your extension code, you can use the `useMutation` hook that comes straight from the integration with [Tanstack Query](https://tanstack.com/query):

```tsx title="modules/popup/form.tsx"
import { api } from "~/lib/api";

export const CreatePost = () => {
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

  return <form onSubmit={onSubmit(mutate)} />;
};
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

    export const Posts = () => {
      const { data: posts, isLoading } = useQuery({
        queryKey: ["posts"],
        queryFn: handle(api.posts.$get),
      });

      if (isLoading) {
        return <p>Loading...</p>;
      }

      /* do something with the data... */
      return (
        <div>
          <p>{JSON.stringify(posts)}</p>
        </div>
      );
    };
    ```
  </Tab>

  <Tab value="Mutations">
    ```tsx
    // [!code word:handle]
    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/client";

    export const CreatePost = () => {
      const queryClient = useQueryClient();
      const { mutate } = useMutation({
        mutationFn: handle(api.posts.$post),
        onSuccess: () => {
          toast.success("Post created successfully!");
          queryClient.invalidateQueries({ queryKey: ["posts"] });
        },
      });

      return <form onSubmit={onSubmit(mutate)} />;
    };
    ```
  </Tab>
</Tabs>

With this approach, you can focus on the business logic instead of repeatedly writing code to handle API responses in your browser extension components, making your extension's codebase more readable and maintainable.

The same error handling and response unwrapping benefits apply whether you're building web, mobile, or extension interfaces - allowing you to keep your data fetching logic consistent across all platforms.
