---
title: Data model
description: Entities and relationships for organizations and multi-tenancy.
url: /docs/web/organizations/data-model
---

# Data model

Our multi-tenant model is organized around the concept of an **organization**. An organization represents a single tenant and is the primary boundary for data isolation, access control, and routing.

Users can belong to multiple organizations through a membership. Invitations let organization admins onboard new members by email with a specific role.

<OrganizationsDbFlow />

## Entities

### Organization

The tenant. Stores human-friendly `name`, unique `slug` (used in URLs and lookups), optional `logo`, and optional `metadata` for extensibility (feature flags, billing context, UI preferences, etc.). `createdAt` provides auditability. The `slug` is globally unique to keep URLs stable and predictable.

### User

The identity of a person. Users are global and can join many organizations. Account-level fields (e.g., `name`, `email`, verification, avatar, security flags) live here.

<Callout type="warn">
  A user's application-wide properties (like a global `role` or moderation flags) are distinct from their per-organization role.
</Callout>

### Member (Membership)

The join between a `user` and an `organization`. This is where multi-tenancy permissions are enforced. Each membership stores the `role` the user holds in that specific organization (for example, `member`, `admin`).

Memberships include timestamps for auditing and can be cascaded when a user or organization is removed.

### Invitation

Represents an invite to join an organization by `email` with an intended `role`. It includes `status` (e.g., pending, accepted, revoked), `expiresAt`, and `inviterId` for traceability.

On acceptance, an invitation creates a corresponding membership if one does not already exist.

## Relationships and constraints

<Accordions type="multiple">
  <Accordion title="Many-to-many">
    Users and organizations are related many-to-many through memberships. A user
    can join multiple organizations; an organization has multiple members.
  </Accordion>

  <Accordion title="Uniqueness">
    We keep `organization.slug` unique across the system to ensure
    consistent routing and discoverability. Within a single organization, each
    `userId` should only appear once in memberships; enforce this
    at the application layer or with a composite unique index
    `(organizationId, userId)`.
  </Accordion>

  <Accordion title="Cascades">
    * Deleting an organization removes its dependent memberships and invitations.
    * Deleting a user removes their memberships and invitations.

    These cascades preserve referential integrity and prevent orphaned records.
  </Accordion>
</Accordions>

## Tenancy and isolation

### Tenant separator

`organizationId` is the tenant key. All tenant-scoped data should either live under the organization or reference it directly. Every read/write path in the application should be constrained by the current `organizationId`.

### Query guardrails

Derive the active `organizationId` from authenticated context (session or URL slug → lookup → id). Apply `organizationId` filters at the repository/service layer to avoid cross‑tenant reads. Add composite indexes that include `organizationId` on frequently queried relations.

### Isolation level

All organizations share the same database and schema, separated by `organizationId`. This keeps operations simple and cost‑effective. If stricter isolation is needed, evolve toward schema‑per‑tenant or database‑per‑tenant with care, as operational overhead increases.

<Callout title="Rename organizations">
  The term "organizations" is used throughout the starter kit to identify a group of users. However, depending on your application's needs, you might want to represent these groups with a different name, such as "Teams" or "Workspaces."

  If that's the case, we suggest retaining "organization" as the internal term within your codebase (to avoid the complexity of renaming it everywhere), while customizing the UI labels to your preferred terminology. To do this, simply update all user-facing instances of "Organization" in your interface to reflect the term that best fits your application.
</Callout>

## Lifecycle flows

* **Create organization**: Create an organization (with `name`, `slug`, optional `logo`/`metadata`) and immediately create a membership for the creator with an elevated role (commonly `owner`).
* **Invite member**:
  1. Admin creates an invitation specifying `email` and intended `role`.
  2. The invite is sent by email with an expiring token.
  3. On acceptance, if the user exists they are added as a member; otherwise they register and then join.
  4. Handle idempotency so repeated accepts don’t duplicate memberships.
* **Leave or remove**: Members can leave an organization and admins can remove members. The policy that "at least one owner must remain" is enforced at the application layer.
