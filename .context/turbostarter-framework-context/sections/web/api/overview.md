---
title: Overview
description: Get started with the API.
url: /docs/web/api/overview
---

# Overview

TurboStarter is designed to be a scalable and production-ready full-stack starter kit. One of its core features is a dedicated and extensible API layer. To enable this in a type-safe manner, we chose [Hono](https://hono.dev) as the API server and client library.

<Callout title="Why Hono?">
  Hono is a small, simple, and ultrafast web framework that gives you a way to
  define your API endpoints with full type safety. It provides built-in
  middleware for common needs like validation, caching, and CORS.

  It also
  includes an [RPC client](https://hono.dev/docs/guides/rpc) for making
  type-safe function calls from the frontend. Being edge-first, it's optimized
  for serverless environments and offers excellent performance.
</Callout>

All API endpoints and their resolvers are defined in the `packages/api` package. Here you will find a `modules` folder that contains the different feature modules of the API. Each module has its own folder and exports all its resolvers.

For each module, we create a separate Hono router and then aggregate all sub-routers into one main router in the `index.ts` file.

The API is then exposed as a route handler that will be provided as a Next.js API route:

```ts title="apps/web/src/app/api/[...route]/route.ts"
import { handle } from "hono/vercel";

import { appRouter } from "@turbostarter/api";

const handler = handle(appRouter);
export {
  handler as GET,
  handler as POST,
  handler as OPTIONS,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
};
```

<Callout type="warn" title="API availability">
  The API is a part of web, serverless Next.js app. It means that you **must**
  deploy it to use the API in other apps (e.g. mobile app, browser extension),
  even if you don't need web app itself. It's very simple, as you're just
  deploying the Next.js app and the API is just a part of it.
</Callout>

Learn more about API in the following sections:
