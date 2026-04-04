---
title: Overview
description: Learn how to authenticate users in your extension.
url: /docs/extension/auth/overview
---

# Overview

TurboStarter uses [Better Auth](https://better-auth.com) to handle authentication. It's a secure, production-ready authentication solution that integrates seamlessly with many frameworks and provides enterprise-grade security out of the box.

<Callout title="Why Better Auth?">
  One of the core principles of TurboStarter is to do things **as simple as possible**, and to make everything **as performant as possible**.

  Better Auth provides an excellent developer experience with minimal configuration required, while maintaining enterprise-grade security standards. Its framework-agnostic approach and focus on performance makes it the perfect choice for TurboStarter.

  Recently, Better Auth [announced](https://www.better-auth.com/blog/authjs-joins-better-auth) an incorporation of [Auth.js (27k+ stars on Github)](https://authjs.dev/), making it even more powerful and flexible.
</Callout>

![Better Auth](/images/docs/better-auth.png)

You can read more about Better Auth in the [official documentation](https://better-auth.com/docs).

<Callout type="info" title="IMPORTANT: Shared authentication">
  To keep things simple and secure, **the extension shares the same authentication session with your web app.**

  This is a common approach used by popular services like [Notion](https://www.notion.so) and [Google Workspace](https://workspace.google.com/). The benefits include:

  * Users only need to sign in once through the web app
  * The extension automatically inherits the authenticated session
  * Sign out actions are synchronized across platforms
  * Reduced security surface area and complexity
</Callout>

Before setting up extension authentication, make sure to first [configure authentication for your web app](/docs/web/auth/overview) and then head back to the extension code.

The following sections cover everything you need to know about authentication in your extension:

<Cards>
  <Card title="Configuration" description="Configure authentication for your application." href="/docs/web/auth/configuration" />

  <Card title="User flow" description="Discover the authentication flow in Turbostarter." href="/docs/web/auth/flow" />

  <Card title="OAuth" description="Get started with social authentication." href="/docs/web/auth/oauth" />

  <Card title="Session" description="Learn how to manage auth session in your extension." href="/docs/extension/auth/session" />
</Cards>
