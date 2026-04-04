---
title: Adding new endpoint
description: How to add new endpoint to the API.
url: /docs/web/api/new-endpoint
---

# Adding new endpoint

To define a new API endpoint, you can either extend an existing entity (e.g. add new customer route) or create a new, separate module.

<Steps>
  <Step>
    ## Create new module

    To create a new module you can create a new folder in the `modules` folder. For example `modules/posts`.

    Then you would need to create a router declaration for this module. We're following a convention with the filename describing its purpose, so you would need to create a file named `router.ts` in the `modules/posts` folder.

    ```typescript title="modules/posts/router.ts"
    import { Hono } from "hono";

    import { validate } from "../../middleware";

    export const postsRouter = new Hono().get(
      "/",
      validate("query", filtersSchema),
      (c) => getAllPosts(c.req.valid("query")),
    );
    ```

    As you can see we're implementing a `.get` method without any additional middlewares for the router. This is a simple way to define a new GET endpoint.

    Also, we're using a [zod](https://zod.dev/) validator to ensure that input passed to the endpoint is correct.
  </Step>

  <Step>
    ### Maybe mutation?

    The same way you can define a mutation for the new entity, just by changing the `get` to `post`:

    ```ts title="modules/posts/router.ts"
    // [!code word:.post]
    export const postsRouter = new Hono().post(
      "/",
      enforceAuth,
      validate("json", postSchema),
      (c) => createPost(c.req.valid("json")),
    );
    ```

    Hono supports all [HTTP methods](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods), so you can define a new endpoint for any method you need (e.g. `put`, `delete`, etc.).

    The `enforceAuth` middleware ensures that only authenticated users can access the endpoint, while the zod validator checks if the input data matches the expected schema. This combination provides both authentication and data validation in a single, clean setup.

    [Read more about protected routes](/docs/web/api/protected-routes).
  </Step>

  <Step>
    ## Implement logic

    Then you would need to create a controller for this module. There is a place, where the logic happens, e.g. for the `GET /` endpoint we would need to create a `getAllPosts` function which will fetch posts from the database.

    ```typescript title="modules/posts/queries.ts"
    import { db } from "@turbostarter/db/server";
    import { posts } from "@turbostarter/db/schema";

    export const getAllPosts = (filters: Filters) => {
      return db.select().from(posts).all().where(/* your filter logic here */);
    };
    ```
  </Step>

  <Step>
    ## Register router

    To make the module and its endpoints available in the API you need to register a router for this module in the `index.ts` file:

    ```ts title="index.ts"
    import { postsRouter } from "./modules/posts/router";

    const appRouter = new Hono()
      .basePath("/api")
      .route("/posts", postsRouter)
      /* other routers from your app logic */
      .onError(onError);

    type AppRouter = typeof appRouter;

    export type { AppRouter };
    export { appRouter };
    ```

    The `basePath` method sets a prefix for all routes in this router. While optional, using it helps organize API endpoints. This modular approach makes the API structure clearer and easier to maintain.
  </Step>
</Steps>

That's it! You've just created a new API endpoint - it's now available at `/api/posts` 🎉

<Callout title="It's fully type-safe!">
  By exporting the `AppRouter` type you get fully type-safe RPC calls in the
  client. It's important because without producing a huge amount of code, we're
  fully type-safe from the frontend code. It helps avoid passing incorrect data
  to the procedure and streamline consuming returned types without a need to
  define these types by hand.
</Callout>
