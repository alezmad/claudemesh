---
title: Database
description: Get started with the database.
url: /docs/extension/database
---

# Database

<Callout type="error" title="API deployment required">
  To enable communication between your WXT extension and the server in a production environment, the web application with Hono API must be deployed first.

  <Cards>
    <Card title="API" description="Learn more about the API." href="/docs/web/api/overview" />

    <Card title="Web deployment" description="Deploy your web application to production." href="/docs/web/deployment/checklist" />
  </Cards>
</Callout>

As browser extensions use only client-side code, **there's no way to interact with the database directly**.

Also, you should avoid any workarounds to interact with the database directly, because it can lead to leaking your database credentials and other security issues.

## Recommended approach

You can safely use the [API](/docs/extension/api/overview) and invoke procedures which will run queries on the database.

To do this you need to set up the database on the [web, server side](/docs/web/database/overview) and then use the [API client](/docs/extension/api/client) to interact with it.

Learn more about its configuration in the web part of the docs, especially in the following sections:

<Cards>
  <Card title="Overview" description="Get started with the database" href="/docs/web/database/overview" />

  <Card title="Schema" description="Learn about the database schema." href="/docs/web/database/schema" />

  <Card title="Migrations" description="Migrate your changes to the database." href="/docs/web/database/migrations" />

  <Card title="Database client" description="Use database client to interact with the database." href="/docs/web/database/client" />
</Cards>
