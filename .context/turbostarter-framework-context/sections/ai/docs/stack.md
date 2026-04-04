---
title: Tech stack
description: Learn which tools and libraries power TurboStarter AI.
url: /ai/docs/stack
---

# Tech stack

## Turborepo

[Turborepo](https://turbo.build/) is a high-performance monorepo tool that optimizes dependency management and script execution across your project. We chose this monorepo setup to simplify feature management and enable seamless code sharing between packages.

<Card href="https://turbo.build/" title="Turborepo - Make Ship Happen" description="turbo.build" icon={<Turborepo />} />

## Next.js

[Next.js](https://nextjs.org) is a powerful [React](https://react.dev) framework that delivers server-side rendering, static site generation, and more. We selected Next.js for its exceptional flexibility and developer experience. It also serves as the foundation for our serverless API.

<Cards>
  <Card href="https://react.dev" title="React" description="react.dev" icon={<React />} />

  <Card href="https://nextjs.org" title="Next.js" description="nextjs.org" icon={<Next />} />
</Cards>

## React Native + Expo

[React Native](https://reactnative.dev/) is a leading open-source framework created by Facebook that enables building native mobile applications using [React](https://react.dev). It provides access to native platform capabilities while maintaining the development efficiency of React.

[Expo](https://expo.dev/) extends React Native with a comprehensive toolkit that streamlines development, building, and deployment of iOS, Android, and web apps from a single codebase.

<Cards className="grid-cols-2">
  <Card href="https://reactnative.dev/" title="React Native" description="reactnative.dev" icon={<React />} />

  <Card href="https://expo.dev/" title="Expo" description="expo.dev" icon={<Expo />} />
</Cards>

## AI SDK

[Vercel AI SDK](https://sdk.vercel.ai/) provides a robust toolkit for building AI-powered applications. It offers essential utilities and components for integrating advanced AI features, including streaming responses, interactive chat interfaces, and more.

<Card href="https://sdk.vercel.ai/" title="Vercel AI SDK" description="sdk.vercel.ai" icon={<AISDK />} />

## LangChain

[LangChain](https://js.langchain.com/) is a sophisticated framework designed for language model-powered applications. It delivers critical abstractions and tools for building complex AI systems, including prompt management, memory systems, and agent architectures.

<Card href="https://js.langchain.com/" title="LangChain" description="js.langchain.com" icon={<Langchain />} />

## Hono

[Hono](https://hono.dev) is an ultrafast, lightweight web framework optimized for edge computing. It includes a type-safe RPC client for secure function calls from the frontend. We leverage Hono to create efficient serverless API endpoints.

<Card href="https://hono.dev" title="Hono" description="hono.dev" icon={<Hono />} />

## Tailwind CSS

[Tailwind CSS](https://tailwindcss.com) is a utility-first CSS framework that accelerates UI development without writing custom CSS. We complement it with [Radix UI](https://radix-ui.com), a collection of accessible headless components, and [shadcn/ui](https://ui.shadcn.com), which lets you generate beautifully designed components with a single command.

<Cards className="grid-cols-2 sm:grid-cols-3">
  <Card href="https://tailwindcss.com" title="Tailwind CSS" description="tailwindcss.com" icon={<Tailwind />} />

  <Card href="https://radix-ui.com" title="Radix UI" description="radix-ui.com" icon={<Radix />} />

  <Card href="https://ui.shadcn.com" title="shadcn/ui" description="ui.shadcn.com" icon={<Shadcn />} />
</Cards>

## Drizzle

[Drizzle](https://orm.drizzle.team/) is a type-safe, high-performance [ORM](https://orm.drizzle.team/docs/overview) (Object-Relational Mapping) for modern database management. It generates TypeScript types from your schema and enables fully type-safe queries.

We use [PostgreSQL](https://www.postgresql.org) as our default database, but Drizzle's flexibility allows you to easily switch to MySQL, SQLite, or any [other supported database](https://orm.drizzle.team/docs/connect-overview) by updating a few configuration lines.

<Cards>
  <Card href="https://orm.drizzle.team/" title="Drizzle" description="orm.drizzle.team" icon={<Drizzle />} />

  <Card href="https://www.postgresql.org" title="PostgreSQL" description="postgresql.org" icon={<Postgres />} />
</Cards>
