---
title: Using API client
description: How to use API client to interact with the API.
url: /docs/web/api/client
---

# Using API client

In Next.js, you can access the API client in two ways:

* **server-side**: in server components and API routes
* **client-side**: in client components

When you create a new page and want to fetch data, you have flexibility in where to make the API calls. Server Components are great for initial data loading since the fetching happens during server-side rendering, eliminating an extra client-server round trip. The data is then efficiently streamed to the client.

By default in Next.js, every component is a Server Component. You can opt into client-side rendering by adding the `use client` directive at the top of a component file. Client Components are useful when you need interactive features or want to fetch data based on user interactions. While they're initially server-rendered, they're also hydrated and rendered on the client, allowing you to make API calls directly from the browser.

Let's explore both approaches to understand their differences and use cases.

## Server-side

We're creating a server-side API client inside `apps/web/src/lib/api/server.ts` file. The client automatically handles passing authentication headers from the user's session to secure API endpoints.

It's pre-configured with all the necessary setup, so you can start using it right away without any additional configuration.

Then, there is nothing simpler than calling the API from your server component:

```tsx title="page.tsx"
import { api } from "~/lib/api/server";

export default async function MyServerComponent() {
  const response = await api.posts.$get();
  const posts = await response.json();

  /* do something with the data... */
  return <div>{JSON.stringify(posts)}</div>;
}
```

<Card title="Next.js - Server components" description="nextjs.org" href="https://nextjs.org/docs/app/building-your-application/rendering/server-components" />

## Client-side

We're creating a separate client-side API client in `apps/web/src/lib/api/client.tsx` file. It's a simple wrapper around the [@tanstack/react-query](https://tanstack.com/query/latest/docs/framework/react/overview) that fetches or mutates data from the API.

It also requires wrapping your app in a `QueryClientProvider` component to provide the query client to the rest of the app:

```tsx title="layout.tsx"
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <QueryClientProvider>{children}</QueryClientProvider>
      </body>
    </html>
  );
}
```

Of course, it's all already configured for you, so you just need to start using `api` in your client components:

```tsx title="page.tsx"
"use client";

import { api } from "~/lib/api/client";

export default function MyClientComponent() {
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
    return <div>Loading...</div>;
  }

  /* do something with the data... */
  return <div>{JSON.stringify(posts)}</div>;
}
```

<Card title="Next.js - Client components" description="nextjs.org" href="https://nextjs.org/docs/app/building-your-application/rendering/client-components" />

<Callout type="warn" title="Ensure correct API url">
  Inside the `apps/web/src/lib/api/utils.ts` we're calling a function to get base url of your api, so make sure it's set correctly (especially on production) and your API endpoint is corresponding with the name there.

  ```tsx title="utils.ts"
  export const getBaseUrl = () => {
    if (typeof window !== "undefined") return window.location.origin;
    if (env.NEXT_PUBLIC_URL) return env.NEXT_PUBLIC_URL;
    if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
    return `http://localhost:${process.env.PORT ?? 3000}`;
  };
  ```

  As you can see we're mostly relying on the [environment variables](/docs/web/configuration/environment-variables) to get it, so there shouldn't be any issues with it, but in case, please be aware where to find it 😉
</Callout>

## Handling responses

As you can see in the examples above, the [Hono RPC](https://hono.dev/docs/guides/rpc) client returns a plain `Response` object, which you can use to get the data or handle errors. However, implementing this handling in every query or mutation can be tedious and will introduce unnecessary boilerplate in your codebase.

That's why we've developed the `handle` function that unwraps the response for you, handles errors, and returns the data in a consistent format. You can safely use it with any procedure from the API client:

<Tabs items={["Server-side", "Client-side"]}>
  <Tab value="Server-side">
    ```tsx
    // [!code word:handle]
    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/server";

    export default async function MyServerComponent() {
      const posts = await handle(api.posts.$get)();

      /* do something with the data... */
      return <div>{JSON.stringify(posts)}</div>;
    }
    ```
  </Tab>

  <Tab value="Client-side">
    ```tsx
    // [!code word:handle]

    "use client";

    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/client";

    export default function MyClientComponent() {
      const { data: posts, isLoading } = useQuery({
        queryKey: ["posts"],
        queryFn: handle(api.posts.$get),
      });

      if (isLoading) {
        return <div>Loading...</div>;
      }

      /* do something with the data... */
      return <div>{JSON.stringify(posts)}</div>;
    }
    ```
  </Tab>
</Tabs>

With this approach, you can focus on the business logic instead of repeatedly writing code to handle API responses in your browser extension components, making your extension's codebase more readable and maintainable.

The same error handling and response unwrapping benefits apply whether you're building web, mobile, or extension interfaces - allowing you to keep your data fetching logic consistent across all platforms.
