---
title: Authentication
description: Learn about the authentication flow in TurboStarter AI.
url: /ai/docs/auth
---

# Authentication

TurboStarter AI implements a streamlined authentication approach powered by [Better Auth](https://www.better-auth.com/). Since the primary focus is showcasing AI capabilities, we've kept the initial authentication simple, allowing you to quickly integrate and experiment with AI features.

## Anonymous sessions

When someone first visits the AI application, an **anonymous session** is automatically created. This establishes a unique user identity without requiring login credentials.

These anonymous sessions serve two critical purposes:

1. **Persistence:** links data like chat history or generated content to specific users in your database
2. **Usage control:** enables tracking for rate limiting and the credits system, ensuring fair AI resource usage even for anonymous visitors

## Extending authentication

While the default anonymous setup provides a frictionless initial experience, TurboStarter is built for growth. The authentication logic uses Better Auth in the shared `packages/auth` package, ensuring consistency between web and mobile applications.

When your project needs more sophisticated authentication features like:

* Email/Password login
* Magic links
* Social logins (OAuth)
* Multi-factor authentication

You can easily integrate these by leveraging the comprehensive authentication system in the [TurboStarter Core kit](/docs/web). The underlying structure is already in place, making this transition straightforward.

For detailed implementation guides, check out the core documentation:

<Cards>
  <Card title="Web authentication" href="/docs/web/auth/overview" description="Explore the full authentication capabilities for the web application." />

  <Card title="Mobile authentication" href="/docs/mobile/auth/overview" description="Learn how authentication works within the mobile application." />
</Cards>

By starting with anonymous sessions, the AI kit lets you focus on building compelling AI features first, while providing a clear path to implement advanced user management and security as your application evolves.
