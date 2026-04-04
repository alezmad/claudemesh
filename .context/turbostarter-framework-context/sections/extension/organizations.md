---
title: Organizations/teams
description: Learn how to use organizations/teams/multi-tenancy in TurboStarter extension.
url: /docs/extension/organizations
---

# Organizations/teams

TurboStarter extensions support organizations/teams out of the box by sharing the same authentication session as your web app. The active organization is stored in the session and available to your extension without re-implementing organizations logic.

<Callout type="info" title="Shared session and tenant context">
  The extension and web app use a single auth session powered by Better Auth. The session includes tenant context (for example, `activeOrganizationId`). When users sign in, switch organizations, or sign out in the web app, the extension picks up these changes automatically.

  Learn more: [Auth → Session](/docs/extension/auth/session).
</Callout>

## How it works

* **No separate auth flow** in the extension. We reuse the web session.
* **Active organization comes from the session** (e.g., `session.activeOrganizationId`).
* **Protected API calls** from the extension include the right cookies, so org‑scoped server logic works as expected.

![Shared authentication with organizations in extension](/images/docs/extension/organizations.png)

## Active organization

Use your existing auth client to read the active organization through the `useActiveOrganization` hook.

```tsx title="popup.tsx"
import { authClient } from "~/lib/auth";

export function Popup() {
  const organization = authClient.useActiveOrganization();

  return <>{organization?.name}</>;
}
```

<Callout title="Switching organizations">
  If a user switches organizations in the web app, the extension reflects the change through the shared session on the next interaction. For long-lived views, re-read the session or invalidate related queries when appropriate.
</Callout>

## Do more with organizations

Most organization features live in the web app and are exposed via APIs your extension can call. These guides explain the underlying concepts and server behavior your extension builds upon:

<Cards>
  <Card title="Overview" description="Concepts and architecture" href="/docs/web/organizations/overview" />

  <Card title="Data model" description="Tables and relationships" href="/docs/web/organizations/data-model" />

  <Card title="Active organization" description="How organization context is resolved" href="/docs/web/organizations/active-organization" />

  <Card title="RBAC" description="Roles and permissions" href="/docs/web/organizations/rbac" />

  <Card title="Invitations" description="Invite teammates and manage members" href="/docs/web/organizations/invitations" />
</Cards>

<Callout>
  Looking for the underlying auth setup? Start with [Auth →
  Overview](/docs/extension/auth/overview) and [Auth →
  Session](/docs/extension/auth/session).
</Callout>
