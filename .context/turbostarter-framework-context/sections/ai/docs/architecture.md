---
title: Architecture
description: A quick overview of the different parts of the TurboStarter AI.
url: /ai/docs/architecture
---

# Architecture

TurboStarter AI integrates several best-in-class open source libraries to power its diverse functionalities, including authentication, data persistence, text generation, and more. Here's a concise overview of the architecture that makes everything work together.

<ThemedImage alt="AI Architecture diagram" light="/images/docs/ai/architecture/light.png" dark="/images/docs/ai/architecture/dark.png" width={2526} height={1561} zoomable />

## Application framework

The project leverages a [monorepo structure](https://turbo.build/repo) powered by [Turborepo](https://turbo.build/) to enable efficient code sharing and consistent tooling across the entire application ecosystem. This approach creates a single source of truth for shared code and dramatically simplifies dependency management.

<Files>
  <Folder name="apps" defaultOpen>
    <Folder name="web - Web app (Next.js)" />

    <Folder name="mobile - Mobile app (React Native - Expo)" />
  </Folder>

  <Folder name="packages" defaultOpen>
    <Folder name="ai - AI features" />

    <Folder name="api - API server (including all features logic)" />

    <Folder name="auth - Authentication setup" />

    <Folder name="db - Database setup" />

    <Folder name="i18n - Internationalization setup" />

    <Folder name="shared - Shared utilities and helpers" />

    <Folder name="storage - Storage setup" />

    <Folder name="ui - Atomic UI components">
      <Folder name="shared" />

      <Folder name="web" />

      <Folder name="mobile" />
    </Folder>
  </Folder>
</Files>

### Web

Built with [Next.js](https://nextjs.org) and [React](https://react.dev), the web application leverages server-side rendering and static site generation for optimal performance and SEO. The UI is styled with [Tailwind CSS](https://tailwindcss.com) and [shadcn/ui](https://ui.shadcn.com) components for rapid development and consistent design. API routes are handled by [Hono](https://hono.dev) for edge computing, chosen for its minimal overhead and excellent TypeScript support.

<Card title="Web | TurboStarter" href="/docs/web" description="Learn more about the core web application and its features." />

### Mobile

The mobile application uses [React Native](https://reactnative.dev) with [Expo](https://expo.dev) for cross-platform development. This combination was selected for its ability to share up to 90% of code between platforms while maintaining native performance. The integration with the monorepo allows seamless sharing of business logic and types with the web application.

<Card title="Mobile | TurboStarter" href="/docs/mobile" description="Learn more about the mobile application and its features." />

## API

The API is implemented as a dedicated package using [Hono](https://hono.dev), a lightweight framework optimized for edge computing. This architectural decision creates a clear separation between frontend and backend logic, enhancing maintainability and testability.

Hono's exceptional TypeScript support ensures type safety across all endpoints, while its minimal footprint and edge-first design deliver outstanding performance.

<Card title="API" href="/ai/docs/api" description="Discover API service in AI starter and demo apps." />

## Model providers

TurboStarter AI seamlessly integrates with leading AI model providers including [OpenAI](/ai/docs/openai), [Anthropic](/ai/docs/anthropic), [Google AI](/ai/docs/google), [xAI](/ai/docs/xai), and more. The architecture employs [AI SDK](https://sdk.vercel.ai/) to create a unified interface across diverse providers, simplifying experimentation with different models.

The platform strategically utilizes specialized models for distinct AI tasks:

* **Text generation** models for conversational AI and content creation
* **Structured output** models for precise data extraction and formatting
* **Image generation** models for visual content creation
* **Voice synthesis** models for natural audio production
* **Embedding** models for semantic search and information retrieval

Switching models requires just a **one-line code change**, allowing you to rapidly adapt to emerging models or change providers based on your specific requirements. This flexibility ensures your application can leverage the latest AI advancements without extensive refactoring.

## Authentication

The applications use [Better Auth](https://www.better-auth.com/) for authentication, providing a secure and flexible authentication system. By default, the AI implementation creates an anonymous user session at startup, which is then used for all subsequent queries and interactions with the AI models. This approach maintains user context across sessions while minimizing friction.

For more sophisticated authentication requirements, you can easily extend the flow by leveraging the [Core implementation](/docs/web/auth/overview), which supports email/password authentication, magic links, OAuth providers, and more. This modular design lets you implement precisely the level of security your application demands.

<Card title="Authentication" href="/ai/docs/auth" description="Learn more about the authentication system in TurboStarter AI." />

## Persistence

Persistence in TurboStarter AI refers to the system's ability to store and retrieve data from a database. The application uses [PostgreSQL](https://www.postgresql.org/) as its primary database to store critical information such as:

* Chat history and conversation context
* User accounts and preference settings
* Vector embeddings for retrieval-augmented generation

To interact with the database from route handlers and server actions, TurboStarter AI leverages [Drizzle ORM](https://orm.drizzle.team/), a high-performance TypeScript ORM that provides type-safe database operations. This ensures robust data integrity and simplified query construction throughout the application.

A key advantage of Drizzle is its compatibility with multiple database providers including [Neon](https://neon.tech/), [Supabase](https://supabase.com/), and [PlanetScale](https://planetscale.com/). This flexibility allows seamless switching between providers based on your specific requirements without modifying queries or schema definitions — making your application highly adaptable to evolving infrastructure needs.

<Card title="Database" href="/ai/docs/database" description="Explore the database architecture and persistence layer in TurboStarter AI." />

## Blob storage

File storage is managed through S3-compatible services, providing scalable, reliable storage for diverse file types. The system efficiently handles user-uploaded images, AI-generated content, and document files. This approach ensures optimal file management and straightforward integration with various storage providers including [AWS S3](https://aws.amazon.com/s3/), [Cloudflare R2](https://www.cloudflare.com/products/r2/), or [MinIO](https://min.io/).

<Card title="Storage" href="/ai/docs/storage" description="Learn more about the storage system in TurboStarter AI." />

## Security

Security is implemented comprehensively to protect both the application and its users. All API endpoints incorporate **rate limiting** to prevent abuse and ensure fair resource allocation.

The system uses a **credits-based access** control system, where each user has a limited number of credits for AI operations, preventing resource exhaustion and enabling monetization options.

All external API interactions, including those with AI model providers, occur exclusively server-side. This ensures that sensitive API keys are **never exposed** to client-side code, significantly reducing vulnerability to unauthorized access or credential theft.

Additionally, the system implements industry-standard security practices including thorough input validation, proper authentication enforcement, and regular dependency security audits.

<Card title="Security" href="/ai/docs/security" description="Explore the security measures in place for TurboStarter AI." />
