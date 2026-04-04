---
title: Database
description: Overview of the database service in TurboStarter AI.
url: /ai/docs/database
---

# Database

The database service, managed within the `packages/db` directory (as `@turbostarter/db`), stores data essential for both core application functions and AI features. It ensures that information like user profiles, conversation history, and AI-generated content is reliably preserved and efficiently accessed.

## Technology

We've chosen [PostgreSQL](https://www.postgresql.org) as our primary relational database for its exceptional reliability, extensibility (including powerful tools like `pgvector` for similarity searches), and proven track record in production environments.

Database interactions are handled through [Drizzle ORM](https://orm.drizzle.team/), a cutting-edge TypeScript ORM that offers outstanding type safety (generating types directly from your schema), high performance, and a developer-friendly API.

For detailed guidance on setup, configuration, schema management (including migrations), and general usage patterns of Drizzle and PostgreSQL in the TurboStarter ecosystem, check out our core documentation:

<Cards>
  <Card title="Overview" description="Get started with the database in the core web application." href="/docs/web/database/overview" />

  <Card title="Schema" description="Learn about the core database schema definitions." href="/docs/web/database/schema" />

  <Card title="Migrations" description="Understand how to manage database schema changes over time." href="/docs/web/database/migrations" />

  <Card title="Client" description="Learn how to interact with the database using the type-safe Drizzle client." href="/docs/web/database/client" />
</Cards>

## What is stored in the database?

Beyond standard application data (like users and accounts), the database plays a crucial role in storing AI-specific information:

* **Chat history**: saves conversations between users and AI models (including reasoning and usage details), enabling continuous conversations and history features
* **Vector embeddings**: stores numerical representations (vectors) of text data (like document chunks) that power Retrieval-Augmented Generation (RAG) techniques, allowing features like [Chat with PDF](/ai/docs/pdf) to quickly find relevant context from large document collections
* **Document references**: tracks metadata and storage identifiers (paths in [Blob Storage](/ai/docs/storage)) for files like uploaded PDFs or AI-generated images, connecting them to relevant user interactions
* **Tool calls & results**: records actions (such as [web searches](/ai/docs/chat) or calculations) that AI models ([Agents](/ai/docs/agents)) perform, along with their outcomes—valuable for debugging, auditing, and improving agent capabilities

## Schema

The core database schema, defined in `packages/db/src/schema`, contains essential tables for the overall application (users, accounts, sessions, etc.).

To maintain clarity as AI features grow, tables specifically related to AI demo applications (like chat history for the [PDF app](/ai/docs/pdf)) are often placed in dedicated [PostgreSQL schemas](https://www.postgresql.org/docs/current/ddl-schemas.html) (e.g. a schema named `pdf`).

This logical separation helps manage complexity and isolates feature-specific data structures. You'll typically find AI-specific schema definitions either alongside the relevant demo app code or within the main `packages/db/src/schema` directory, clearly labeled and organized.
