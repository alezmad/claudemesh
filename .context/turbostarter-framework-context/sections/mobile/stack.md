---
title: Tech Stack
description: A detailed look at the technical details.
url: /docs/mobile/stack
---

# Tech Stack

## Turborepo

[Turborepo](https://turbo.build/) is a monorepo tool that helps you manage your project's dependencies and scripts. We chose a monorepo setup to make it easier to manage the structure of different features and enable code sharing between different packages.

<Card href="https://turbo.build/" title="Turborepo - Make Ship Happen" description="turbo.build" icon={<Turborepo />} />

## React Native + Expo

[React Native](https://reactnative.dev/) is an open-source mobile application development framework created by Facebook. It is used to develop applications for Android and iOS by enabling developers to use [React](https://react.dev) along with native platform capabilities.

> It's like Next.js for mobile development.

[Expo](https://expo.dev/) is a framework and a platform built around React Native. It provides a set of tools and services that help you develop, build, deploy, and quickly iterate on iOS, Android, and web apps from the same JavaScript/TypeScript codebase. It's like Next.js for mobile development.

<Cards className="grid-cols-2">
  <Card href="https://reactnative.dev/" title="React Native" description="reactnative.dev" icon={<React />} />

  <Card href="https://expo.dev/" title="Expo" description="expo.dev" icon={<Expo />} />
</Cards>

## Tailwind CSS

[Uniwind](https://uniwind.dev/) uses Tailwind CSS as scripting language to create a universal style system for React Native. It allows you to use Tailwind CSS classes in your React Native components, providing a familiar styling experience for web developers. We also use [React Native Reusables](https://github.com/mrzachnugent/react-native-reusables) for our headless components library with support of CLI to generate pre-designed components with a single command.

<Cards className="grid-cols-2">
  <Card href="https://uniwind.dev/" title="Uniwind" description="uniwind.dev" icon={<Uniwind />} />

  <Card href="https://github.com/mrzachnugent/react-native-reusables" title="react-native-reusables" description="github.com" icon={<ReactNativeReusables />} />
</Cards>

## Hono & React Query

[Hono](https://hono.dev) is a small, simple, and ultrafast web framework for the edge. It provides tools to help you build APIs and web applications faster. It includes an RPC client for making type-safe function calls from the frontend. We use Hono to build our serverless API endpoints.

To make data fetching and caching from our API easy and reliable, we pair Hono with [React Query](https://tanstack.com/query/latest). It helps manage asynchronous data, caching, and state synchronization between the client and backend, delivering a fast and seamless UX.

<Cards>
  <Card href="https://hono.dev" title="Hono" description="hono.dev" icon={<Hono />} />

  <Card
    href="https://tanstack.com/query/latest"
    title="React Query"
    description="tanstack.com"
    icon={
      <img src="/images/icons/tanstack.png" alt="" width={32} height={32} />
    }
  />
</Cards>

## Better Auth

[Better Auth](https://www.better-auth.com) is a modern authentication library for fullstack applications. It provides ready-to-use snippets for features like email/password login, magic links, OAuth providers, and more. We use Better Auth to handle all authentication flows in our application.

<Card href="https://www.better-auth.com" title="Better Auth" description="better-auth.com" icon={<BetterAuth />} />

## Drizzle

[Drizzle](https://orm.drizzle.team/) is a super fast [ORM](https://orm.drizzle.team/docs/overview) (Object-Relational Mapping) tool for databases. It helps manage databases, generate TypeScript types from your schema, and run queries in a fully type-safe way.

We use [PostgreSQL](https://www.postgresql.org) as our default database, but thanks to Drizzle's flexibility, you can easily switch to MySQL, SQLite or any [other supported database](https://orm.drizzle.team/docs/connect-overview) by updating a few configuration lines.

<Cards>
  <Card href="https://orm.drizzle.team/" title="Drizzle" description="orm.drizzle.team" icon={<Drizzle />} />

  <Card href="https://www.postgresql.org" title="PostgreSQL" description="postgresql.org" icon={<Postgres />} />
</Cards>

## EAS (Expo Application Services)

[EAS](https://expo.dev/eas) is a set of cloud services provided by Expo for React Native app development. It includes tools for building, submitting, and updating your app, as well as over-the-air updates and analytics.

<Card href="https://expo.dev/eas" title="EAS (Expo Application Services)" description="expo.dev/eas" icon={<Expo />} />
