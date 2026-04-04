---
title: Mutations
description: Learn how to mutate data on the server.
url: /docs/web/api/mutations
---

# Mutations

As we saw in [adding new endpoint](/docs/web/api/new-endpoint#maybe-mutation), mutations allow us to modify data on the server, like creating, updating, or deleting resources. They can be defined similarly to queries using our API client.

Just like queries, mutations can be executed either server-side or client-side depending on your needs. Let's explore both approaches.

## Server actions

Next.js provides [server actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations) as a powerful way to handle mutations directly on the server. They're particularly well-suited for form submissions and other data modifications.

Using our `api` client with server actions is straightforward - you simply call the API function on the server.

Here's an example of how you can define an action to create a new post:

<Tabs items={["With helper", "Without helper"]}>
  <Tab value="With helper">
    ```tsx
    // [!code word:handle]
    "use server";

    import { revalidatePath } from "next/cache";

    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/server";

    export async function createPost(post: PostInput) {
      try {
        await handle(api.posts.$post)(post);
      } catch (error) {
        onError(error);
      }

      revalidatePath("/posts");
    }
    ```
  </Tab>

  <Tab value="Without helper">
    ```tsx
    "use server";

    import { revalidatePath } from "next/cache";

    import { api } from "~/lib/api/server";

    export async function createPost(post: PostInput) {
      const response = await api.posts.$post(post);

      if (!response.ok) {
        return { error: "Failed to create post" };
      }

      revalidatePath("/posts");
    }
    ```
  </Tab>
</Tabs>

In the above example we're also using `revalidatePath` to revalidate the path `/posts` to fetch the updated list of posts.

<Cards>
  <Card title="Server actions and mutation" description="nextjs.org" href="https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations" />

  <Card title="revalidatePath" description="nextjs.org" href="https://nextjs.org/docs/app/api-reference/functions/revalidatePath" />
</Cards>

## useMutation hook

On the other hand, if you want to perform a mutation on the client-side, you can use the `useMutation` hook that comes straight from the integration with [React Query](https://tanstack.com/query).

<Tabs items={["With helper", "Without helper"]}>
  <Tab value="With helper">
    ```tsx
    // [!code word:handle]
    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/react";

    export function CreatePost() {
      const queryClient = useQueryClient();
      const { mutate } = useMutation({
        mutationFn: handle(api.posts.$post),
        onSuccess: () => {
          toast.success("Post created successfully!");
          queryClient.invalidateQueries({ queryKey: ["posts"] });
        },
      });

      return <form onSubmit={...} />;
    }
    ```
  </Tab>

  <Tab value="Without helper">
    ```tsx
    import { api } from "~/lib/api/react";

    export function CreatePost() {
      const queryClient = useQueryClient();
      const { mutate } = useMutation({
        mutationFn: async (post: PostInput) => {
          const response = await api.posts.$post(post);

          if (!response.ok) {
            throw new Error("Failed to create post!");
          }
        },
        onSuccess: () => {
          toast.success("Post created successfully!");
          queryClient.invalidateQueries({ queryKey: ["posts"] });
        },
      });

      return <form onSubmit={...} />;
    }
    ```
  </Tab>
</Tabs>

<Cards>
  <Card title="useMutation hook" description="tanstack.com" href="https://tanstack.com/query/latest/docs/framework/react/reference/useMutation" />

  <Card title="Query invalidation" description="tanstack.com" href="https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation" />
</Cards>
