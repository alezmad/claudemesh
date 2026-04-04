---
title: Overview
description: Learn how to use organizations/teams/multi-tenancy in TurboStarter mobile app.
url: /docs/mobile/organizations/overview
---

# Overview

Organizations let you build teams and multi-tenant SaaS out of the box in the mobile app.

Users can create organizations, invite teammates, assign roles, and seamlessly switch between workspaces — all from iOS/Android — with the same secure data isolation used on the [web app](/docs/web/organizations/overview).

<Callout title="What is multi-tenancy?">
  [Multi-tenancy](https://www.ibm.com/think/topics/multi-tenant) is a software architecture pattern where a single instance of an application serves multiple tenants, each with its own data and configuration.
</Callout>

The feature is powered by the same [Better Auth organization plugin](https://www.better-auth.com/docs/plugins/organization) and shares TurboStarter's API, routing, and data layer with the [web app](/docs/web/organizations/overview) and [extension](/docs/extension/organizations). That means your mobile app benefits from the same tenancy rules, RBAC checks, and invitations flow without duplicating backend logic.

<ThemedImage light="/images/docs/web/organizations/multi-tenancy/light.png" dark="/images/docs/web/organizations/multi-tenancy/dark.png" alt="Architecture" width={1375} zoomable height={955} />

## Architecture

On mobile, TurboStarter uses the same pragmatic multi-tenant architecture as the [web app](/docs/web/organizations/overview):

* **Tenant context** lives in the authenticated session as the active organization ID. The mobile client reads this context from the API and includes it when making requests.
* **Data scoping** is performed server-side via `organizationId` on tenant-owned tables and guard clauses in queries. Mobile screens consume scoped endpoints so users only see data for their selected organization.
* **Authorization** combines tenant scoping with role checks. We separate “can access this tenant?” from “can perform this action within the tenant?”.
* **Extensibility**: add new tenant-bound entities by including `organizationId` in your schema and using the provided helpers to read or switch the active organization in the app.

This keeps data isolated per organization while remaining simple to reason about across platforms.

<Callout>
  For deeper details on the shared data model used by the mobile app, see [Data
  model](/docs/web/organizations/data-model).
</Callout>

## Concepts

The same core concepts apply in the mobile app:

| Concept                 | Description                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| **Organization**        | A workspace that owns resources and settings, acting as an isolated tenant.                        |
| **Member**              | A user assigned to an organization.                                                                |
| **Role**                | Access level within an organization (see [RBAC](/docs/mobile/organizations/rbac)).                 |
| **Invitation**          | Email request to join an organization (see [Invitations](/docs/mobile/organizations/invitations)). |
| **Active organization** | The currently selected organization in a user's session, used to scope data and permissions.       |

These concepts provide the building blocks for flexible team management and secure, multi-tenant SaaS applications on mobile.

## Development data

In development, TurboStarter automatically [seeds](/docs/mobile/installation/commands#seeding-database) example data when you set up services. The mobile app connects to the same development API, so you can test the full organizations flow end-to-end:

* One organization is created by default.
* All default roles are created and assigned within that organization.
* Sample invitations are generated so you can test the invite flow.

You can safely experiment with these sample organizations, roles, and invitations to understand multi-tenancy features — [reset](/docs/mobile/installation/commands#resetting-database) or [reseed](/docs/mobile/installation/commands#seeding-database) anytime to return to the default state.

The default credentials for demo users can be customized using the `SEED_EMAIL` and `SEED_PASSWORD` environment variables.

<Callout type="error" title="Never run in production">
  The default development data and setup are intended for local development and
  testing only. **Never** use these seeds or configurations in a production
  environment - they are insecure and may expose sensitive functionality.
</Callout>

## Customization

You have flexibility to adapt organizations to fit your mobile experience. For example, you might rename labels (such as Organization to *Team* or *Workspace*), and update the app copy accordingly.

You can adjust the available [roles and permissions](/docs/mobile/organizations/rbac) to suit your access model.

The [invitation flow](/docs/mobile/organizations/invitations) can be customized, including how verification, onboarding, or metadata capture work.

Feel free to check how to configure all of these features inside mobile application in the dedicated sections linked above.
