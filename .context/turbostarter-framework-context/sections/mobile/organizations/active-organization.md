---
title: Active organization
description: Set and switch the current organization context within your application.
url: /docs/mobile/organizations/active-organization
---

# Active organization

The active organization on mobile mirrors the behavior used on the [web app](/docs/web/organizations/active-organization) and in the [extension](/docs/extension/organizations). It is tracked in the authenticated session as `activeOrganizationId` and used to scope all organization-bound data and actions.

Below you can find how to read and work with the active organization in your mobile app context.

## Reading the active organization

Use your auth client's helper to read the active organization from the session. This keeps the client in sync with the server and avoids duplicating tenancy logic.

```tsx title="organizations.tsx"
import { authClient } from "~/lib/auth";

export function OrganizationsScreen() {
  const organization = authClient.useActiveOrganization();
  const member = authClient.useActiveMember();

  return (
    <>
      <Text>{organization?.name}</Text>
      <Text>{member?.role}</Text>
    </>
  );
}
```

This mirrors the [extension](/docs/extension/organizations) approach and the [web hook](/docs/web/organizations/active-organization), ensuring the active organization and member role stay consistent with the server session.

## Performing actions

When invoking API routes from the mobile app, prefer passing the `organizationId` explicitly with the payload. This guarantees the correct tenant is targeted even if multiple devices or views are active simultaneously.

```tsx title="create-post.tsx"
import { api } from "~/lib/api";

export function CreatePost() {
  const activeOrganization = authClient.useActiveOrganization();

  const { mutate } = useMutation({
    mutationFn: async (post: PostInput) =>
      api.posts.$post({
        ...post,
        organizationId: activeOrganization?.id,
      }),
  });

  return (
    <Form>
      <Button onPress={onSubmit(mutate)}>Submit</Button>
    </Form>
  );
}
```

This mirrors the recommendation from the [web guide](/docs/web/organizations/active-organization#api-route) and avoids edge cases tied to stale session values.

## Switching organizations

TurboStarter ships an account switcher out of the box for mobile. You can drop it into your app and customize labels and styling as needed.

```tsx title="settings.tsx"
import { AccountSwitcher } from "~/modules/organization/account-switcher";

export function SettingsScreen() {
  return <AccountSwitcher />;
}
```

When a user selects a new organization, it calls your backend to update the session's `activeOrganizationId` and then re-read the session or invalidate related queries.

For deeper background on how the active organization is resolved, see the [web guide](/docs/web/organizations/active-organization).
