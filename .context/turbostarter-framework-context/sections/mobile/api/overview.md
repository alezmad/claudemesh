---
title: Overview
description: Get started with the API.
url: /docs/mobile/api/overview
---

# Overview

<Callout type="error" title="API deployment required">
  To enable communication between your Expo app and the server in a production environment, the web application with Hono API must be deployed first.

  <Cards>
    <Card title="API" description="Learn more about the API." href="/docs/web/api/overview" />

    <Card title="Web deployment" description="Deploy your web application to production." href="/docs/web/deployment/checklist" />
  </Cards>
</Callout>

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

All API endpoints and their resolvers are defined in the `packages/api/` package. Here you will find a `modules` folder that contains the different feature modules of the API. Each module has its own folder and exports all its resolvers.

For each module, we create a separate Hono route in the `packages/api/index.ts` file and aggregate all sub-routers into one main router.

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

Learn more about how to use the API in your mobile app in the following sections:
