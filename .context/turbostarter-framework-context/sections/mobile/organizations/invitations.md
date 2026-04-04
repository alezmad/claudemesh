---
title: Invitations
description: Send, track, and accept organization invites.
url: /docs/mobile/organizations/invitations
---

# Invitations

Invite teammates by email to join an organization directly from your mobile app. Acceptance is straightforward: we verify the invite, create or reuse the membership with the intended role, and set the user's active organization.

The implementation uses the same APIs and rules as the [web app](/docs/web/organizations/invitations) and is powered by the [Better Auth organization plugin](https://www.better-auth.com/docs/plugins/organization).

![Mobile invitations list](/images/docs/mobile/organizations/invitations/list.png)

## Capabilities

* Send invitations by email.
* View and filter invitations by status or role, and search by email.
* Resend or revoke an invitation.
* Accept an invitation via a [deep link](https://docs.expo.dev/linking/into-your-app/).

<Callout>
  Permissions are enforced by roles. Typically, only organization admins can
  send or manage invites. See [RBAC (Roles &
  Permissions)](/docs/mobile/organizations/rbac).
</Callout>

## Inviting members

Sending an invitation typically requires the invitee's email and the intended role. You can add multiple recipients in the invitation form to invite several members at once.

![Invite members bottom sheet](/images/docs/mobile/organizations/invitations/invite.png)

After sending, the invitee receives an email with a link to accept. It's a [deep link](https://docs.expo.dev/guides/linking) that opens your app and automatically validates the invite.

## Handling invitations

When a recipient opens an invite link on their device, the app automatically handles the entire flow - reading, parsing, and validating the invite - for you.

![Join organization prompt](/images/docs/mobile/organizations/invitations/join.png)

When the user accepts, we create or reuse their membership and set the active organization in their session. If they reject the invite, we redirect them to their account home.

## Learn more

For underlying details shared across platforms, see the web documentation:

<Cards>
  <Card title="Data model" description="Schema for organizations and invitations" href="/docs/web/organizations/data-model" />

  <Card title="Statuses and flow" description="Invitation status codes and how they update" href="/docs/web/organizations/invitations#status" />

  <Card title="Automatic invalidation" description="How invitations are automatically cleaned up" href="/docs/web/organizations/invitations#automatic-invalidation" />

  <Card title="Admin management" description="Admin tooling for managing invitations" href="/docs/web/organizations/invitations#invitation-management" />
</Cards>

These cover the schema, token lifecycle, and admin tooling shared by the mobile and web apps.
