# TurboStarter Framework Patterns

TurboStarter framework patterns and commands.

> **Note:** This file is **subordinate to `.context/CLAUDE.md`**. Project-specific decisions take precedence.
>
> **For more docs:** Check `index.md` for keyword search across 222 documentation pages.

## Purpose

This document contains TurboStarter monorepo patterns, commands, and architecture guidelines:
- Framework-specific commands (pnpm, database, services)
- Monorepo structure and package organization
- Code conventions and patterns established by TurboStarter

**When to consult `.context/project.md` instead:**
- Project-specific architecture decisions
- Project package structure
- Business logic and feature requirements

**Documentation usage**: Examples here are illustrative. Adapt them to match existing repository patterns rather than copying verbatim.

## Project Overview

This is a TurboStarter monorepo - a fullstack SaaS starter kit built with Turborepo. It contains:
- **Web app**: Next.js 16 (App Router) with React 19
- **Mobile app**: React Native + Expo
- **Shared packages**: API (Hono), auth (Better Auth), database (Drizzle + PostgreSQL), billing, email, i18n, UI components

## Essential Commands

### Development
```bash
# Install dependencies (uses pnpm 10.25.0)
pnpm install

# Start Docker services (PostgreSQL)
pnpm services:start

# First-time database setup (migrate + seed)
pnpm with-env -F @turbostarter/db db:setup

# Start all apps in dev mode
pnpm dev

# Start specific app only
pnpm --filter web dev
pnpm --filter mobile dev

# Mobile-specific dev commands
pnpm --filter mobile ios           # Run on iOS simulator
pnpm --filter mobile android       # Run on Android emulator
```

### Database Operations
All database commands must use `pnpm with-env` to load environment variables from `.env` at repo root.

```bash
# Generate migration after schema changes
pnpm with-env -F @turbostarter/db db:generate

# Apply migrations
pnpm with-env -F @turbostarter/db db:migrate

# Push schema directly (dev only - skips migrations)
pnpm with-env -F @turbostarter/db db:push

# Check schema drift
pnpm with-env -F @turbostarter/db db:check

# Open Drizzle Studio (database GUI)
pnpm with-env -F @turbostarter/db db:studio

# Check migration status
pnpm with-env -F @turbostarter/db db:status

# Seed database (dev only)
pnpm with-env -F @turbostarter/db db:seed

# Reset database (dev only)
pnpm with-env -F @turbostarter/db db:reset
```

### Quality & Testing
```bash
# Type check entire monorepo
pnpm typecheck

# Lint (check)
pnpm lint

# Lint (fix)
pnpm lint:fix

# Format (check)
pnpm format

# Format (fix)
pnpm format:fix

# Run tests (Vitest)
pnpm test

# Run tests in watch mode
pnpm test:projects:watch

# Build all packages/apps
pnpm build

# Build specific app
pnpm --filter web build
```

### Services
```bash
# Start Docker services
pnpm services:start

# Stop Docker services
pnpm services:stop

# View service logs
pnpm services:logs

# Check service status
pnpm services:status
```

## Architecture

### Monorepo Structure
- `apps/web/` - Next.js web application
- `apps/mobile/` - React Native (Expo) mobile app
- `packages/api/` - Hono API server with modular routers
- `packages/auth/` - Better Auth configuration and helpers
- `packages/billing/` - Billing integrations (Stripe, LemonSqueezy)
- `packages/db/` - Drizzle ORM schema, migrations, and database utilities
- `packages/email/` - Email templates and providers
- `packages/i18n/` - Internationalization setup and translations
- `packages/shared/` - Common utilities, hooks, constants
- `packages/storage/` - File storage providers and types
- `packages/ui/` - Shared UI components (web/mobile variants)

### API Architecture (Hono)
The API is built with Hono and follows a modular router pattern:

**Main router** (`packages/api/src/index.ts`):
- Base path: `/api`
- Applies middleware: CSRF (web only), CORS, logger, localization
- Routes to sub-routers: `/admin`, `/ai`, `/auth`, `/billing`, `/organizations`, `/storage`

**Module pattern**:
Each feature module (e.g., `packages/api/src/modules/admin/users/`) contains:
- `router.ts` - Hono router with route definitions
- `queries.ts` - Database query functions
- `mutations.ts` - Database mutation functions
- Schema validation via Zod

**Type safety**:
- API types are exported from `packages/api/src/index.ts` as `AppRouter`
- Consumed in web/mobile apps via Hono RPC client for end-to-end type safety

### Web App Structure (Next.js App Router)
```
apps/web/src/app/
├── [locale]/                    # Internationalized routes
│   ├── (marketing)/             # Public routes (landing, blog, pricing)
│   ├── auth/                    # Auth pages (login, register, password reset)
│   ├── dashboard/               # Protected routes
│   │   ├── (user)/              # Personal dashboard
│   │   └── [organization]/      # Organization-scoped routes
│   └── admin/                   # Super admin dashboard
└── api/[...route]/route.ts      # Catch-all API route (proxies to Hono)
```

**Route groups**:
- `(marketing)` - Public pages, shared marketing layout
- `(user)` - Personal user dashboard
- `[organization]` - Multi-tenant org routes, slug-based

**API integration**:
- Server components: Use `api` from `~/lib/api/server.ts`
- Client components: Use `api` from `~/lib/api/client.tsx` with React Query

### Database (Drizzle + PostgreSQL)
**Schema location**: `packages/db/src/schema/`
- Multiple schema files organized by domain
- Exported via `packages/db/src/schema/index.ts`

**Migrations**:
- Generated in `packages/db/migrations/` as SQL files
- Workflow: Edit schema → `db:generate` → `db:migrate`

**Database client**:
- Server-side only via `@turbostarter/db/server`
- Uses Drizzle ORM with PostgreSQL driver
- Connection pooling configured for serverless

**Critical invariants**:
- ❌ **Never** access database directly from web/mobile apps
- ❌ **Never** use raw SQL outside migrations (use Drizzle queries)
- ❌ **Never** skip migrations in production (only `db:push` for local dev)
- ✅ **Always** use `pnpm with-env` for all database commands
- ✅ **Always** go through API layer for data access

### Authentication (Better Auth)
- Server config: `packages/auth/src/server.ts`
- Client helpers: `packages/auth/src/client.tsx`
- Supports: email/password, magic links, OAuth providers, 2FA, passkeys
- Session management via cookies
- Organizations plugin enabled for multi-tenancy

### Multi-tenancy / Organizations
- Organization-scoped routes: `/dashboard/[organization]/...`
- Active organization stored in session (`activeOrganizationId`)
- RBAC: owner, admin, member roles
- Invitation system with email-based invites

### Business Logic Placement

**Core principle**: Business logic lives in the API layer, not in UI components.

**Where logic belongs**:
- **API layer** (`packages/api/src/modules/`): Business rules, validation, authorization, data transformations
- **Database layer** (`packages/db`): Schema definitions, relations, type-safe queries via Drizzle
- **Web/Mobile apps**: Orchestration, presentation, user interaction, calling API endpoints
- **UI packages**: Pure presentation components, no business rules

**Where logic must NOT live**:
- React components (web or mobile)
- UI packages (`@turbostarter/ui-web`, `@turbostarter/ui-mobile`)
- Directly in API route files (use `queries.ts`/`mutations.ts` instead)
- Client-side validation as source of truth (use for UX only; validate server-side)

**Example**:
```tsx
// ❌ BAD - business logic in component
export function UserProfile({ userId }) {
  const canEdit = user.role === 'admin' || user.id === userId;
  // Complex business rules in component
}

// ✅ GOOD - business logic in API
export function UserProfile({ userId }) {
  const { data } = useQuery(api.users.canEdit.$get({ query: { userId } }));
  // API returns authorization decision
}
```

### Layout & Sidebar Patterns

**Dashboard Layout Hierarchy**:
```
layout.tsx (root)
└── [locale]/layout.tsx (i18n wrapper)
    └── dashboard/layout.tsx (main dashboard - no sidebar)
        ├── (user)/layout.tsx (user sidebar + auth check)
        │   ├── page.tsx (home)
        │   ├── ai/page.tsx
        │   └── settings/layout.tsx (sub-nav)
        │       ├── page.tsx (general)
        │       ├── security/page.tsx
        │       └── billing/page.tsx
        ├── [organization]/layout.tsx (org sidebar + auth check + org fetch)
        │   ├── page.tsx (org home)
        │   ├── members/page.tsx
        │   └── settings/layout.tsx (sub-nav)
        └── admin/layout.tsx (admin sidebar + permission check)
            ├── page.tsx (admin home)
            ├── users/page.tsx
            └── organizations/page.tsx
```

**Sidebar Structure**:
Each layout defines its own sidebar menu with groups:
- **User sidebar**: Personal features (home, AI) + account (settings)
- **Organization sidebar**: Platform features (home) + organization (settings, members)
- **Admin sidebar**: Admin resources (users, organizations, customers)

**Common sidebar footer** (all sidebars):
- Support link
- Feedback link
- User navigation (profile, logout)

**Layout Authentication Patterns**:
```tsx
// User dashboard - basic auth
const { user } = await getSession();
if (!user) return redirect(pathsConfig.auth.login);

// Organization dashboard - auth + org fetch + hydration
const { user } = await getSession();
if (!user) return redirect(pathsConfig.auth.login);
const org = await getOrganization({ slug });
if (!org) return redirect(pathsConfig.dashboard.user.index);
// Pre-fetch and hydrate organization data via queryClient

// Admin dashboard - auth + permission check
const { user } = await getSession();
if (!user) return redirect(pathsConfig.auth.login);
if (!hasAdminPermission(user)) return redirect(pathsConfig.dashboard.user.index);
```

## Environment Variables

**Required globals** (defined in `turbo.json`):
- `DATABASE_URL` - PostgreSQL connection string
- `PRODUCT_NAME` - Application name
- `URL` - Base URL for web app
- `DEFAULT_LOCALE` - Default language (e.g., "en")

**Setup**:
1. Create `.env` at repo root
2. Copy from `.env.example` files
3. Commands automatically load via `pnpm with-env`

**App-specific variables**:
- Web: `apps/web/.env.local`
- Mobile: `apps/mobile/.env.local`

## Common UI Patterns

### Dashboard Components
Standard dashboard components from `~/modules/common/layout/dashboard/`:
- `DashboardHeader` - Page header container
- `DashboardHeaderTitle` - Main page title (h1)
- `DashboardHeaderDescription` - Subtitle/description text
- `DashboardInset` - Main content wrapper with proper spacing
- `DashboardSidebar` - Collapsible sidebar with menu
- `SidebarLink` - Navigation link with active state

### Data Tables
For admin/list pages, use the data table pattern:
- `DataTableSkeleton` - Loading skeleton during Suspense
- `createSearchParamsCache` from `nuqs/server` - Type-safe URL params
- `handle()` from `@turbostarter/api/utils` - Unwraps API responses
- React Query for client-side data fetching
- Built-in sorting, filtering, pagination via URL params

### Icons
Import from `@turbostarter/ui-web/icons`:
```tsx
import { Icons } from "@turbostarter/ui-web/icons";

<Icons.Home />
<Icons.Settings />
<Icons.UsersRound />
```

Common icons:
- `Home`, `Settings`, `UsersRound`, `Building` (sidebar)
- `Brain` (AI), `HandCoins` (billing), `LifeBuoy` (support)
- `MessageCircle` (feedback)

### Internationalization (i18n)
- Translation keys: `namespace:key.nested.path`
- Server: `const { t } = await getTranslation({ ns: "dashboard" })`
- Client: `const { t } = useTranslation({ ns: "dashboard" })`
- Sidebar labels auto-translate if key exists in `common.json`
- Metadata: `getMetadata({ title: "common:myFeature" })`

### UI Components (shadcn/ui)
TurboStarter uses [shadcn/ui](https://ui.shadcn.com) for atomic, accessible, customizable components built with Tailwind CSS and Radix UI.

**Two UI packages**:
- `@turbostarter/ui` - Shared styles, themes, assets (icons)
- `@turbostarter/ui-web` - Pre-built web components (Button, Card, Dialog, etc.)

**Adding new components**:
```bash
# From repo root - launches interactive CLI
pnpm --filter @turbostarter/ui-web ui:add

# Or copy-paste from shadcn/ui website into packages/ui/web/src/
```

**Using components** (each has standalone export):
```tsx
// Import from specific component path
import { Card, CardContent, CardHeader } from "@turbostarter/ui-web/card";
import { Button } from "@turbostarter/ui-web/button";
import { Dialog, DialogContent } from "@turbostarter/ui-web/dialog";

// Build app-specific components by composition
export function MyComponent() {
  return (
    <Card>
      <CardHeader>...</CardHeader>
      <CardContent>...</CardContent>
    </Card>
  );
}
```

**Component organization principle**:
- **Shared package** (`@turbostarter/ui-web`): Atomic components (Button, Input, Card, Dialog)
- **App directory** (`apps/web/src/`): Specific composed components (LoginForm, UserProfile)
- Keep shared components atomic for reusability and tree-shaking

## Security Boundaries

**Critical principle**: Authentication and authorization are **server-side only**. Client-side checks are for UX, never security.

**Security rules**:
- ✅ **Auth/authz enforcement**: API layer only (via Better Auth + middleware)
- ✅ **Secrets/env vars**: Server-side packages only (`packages/api`, `packages/db`)
- ✅ **Role checks**: API layer, never client components
- ✅ **Organization permissions**: Validated in API, pre-fetched for UX

**Never do this**:
- ❌ Client-side role/permission checks as source of truth
- ❌ Secrets in web/mobile apps or UI packages
- ❌ Authorization logic in React components
- ❌ Direct API calls bypassing authentication

**Pattern**:
```tsx
// ❌ BAD - client-side auth check
export function AdminPanel() {
  if (user.role !== 'admin') return null; // Security by obscurity!
  return <SensitiveData />;
}

// ✅ GOOD - server-side enforcement
export async function AdminPanel() {
  const { user } = await getSession();
  if (!hasAdminPermission(user)) redirect(pathsConfig.dashboard.user.index);
  const data = await api.admin.getSensitiveData(); // API enforces auth
  return <SensitiveData data={data} />;
}
```

## Architectural Constraints

**Allowed patterns** (use these freely):
- Hono for API routing
- Drizzle ORM for database queries
- Zod for validation
- Better Auth for authentication
- React Server Components (default)
- `nuqs` for URL state
- shadcn/ui for UI components

**Forbidden patterns** (do not introduce):
- ❌ New state management libraries (Redux, Zustand, MobX)
- ❌ Database access outside `@turbostarter/db/server`
- ❌ Bypassing API layer from apps (direct DB access)
- ❌ Business logic in React components
- ❌ Client-side auth checks as security boundaries
- ❌ Ad-hoc environment variable loading (use existing patterns)
- ❌ New packages without justification (see "Adding a new package")
- ❌ Runtime schema mutations or direct SQL queries

**When in doubt**: Ask the user before introducing new dependencies, patterns, or architectural changes.

## Reuse-First Principle

**Critical rule**: Always search for and reuse existing implementations before creating new ones.

### Before implementing ANY feature, check:

1. **Existing UI components** (`packages/ui/web/src/`, `packages/ui/mobile/src/`):
   - Check for similar components (forms, buttons, modals, tables)
   - Use shadcn/ui components via `pnpm --filter @turbostarter/ui-web ui:add`
   - Don't recreate what already exists in the UI packages

2. **Existing utilities** (`packages/shared/src/`):
   - Common functions, hooks, constants
   - Check `packages/shared/src/utils/` before writing helpers
   - Check `packages/shared/src/hooks/` before creating custom hooks

3. **Existing API patterns** (`packages/api/src/modules/`):
   - Look at similar endpoints (users, organizations, admin)
   - Reuse query/mutation patterns from existing modules
   - Use established error handling and validation patterns

4. **Existing database queries** (`packages/db/src/`):
   - Check for similar queries in other modules
   - Reuse Drizzle query patterns
   - Don't duplicate relationship definitions

5. **Existing patterns in similar pages**:
   - Dashboard pages: check `apps/web/src/app/[locale]/dashboard/`
   - Admin pages: check `apps/web/src/app/[locale]/admin/`
   - Auth pages: check `apps/web/src/app/[locale]/auth/`
   - Settings pages: check sub-navigation patterns

### Search workflow before implementing:

```bash
# Search for similar functionality
grep -r "keyword" packages/
grep -r "ComponentName" apps/web/src/

# Check UI components
ls packages/ui/web/src/
ls packages/ui/mobile/src/

# Check utilities
ls packages/shared/src/utils/
ls packages/shared/src/hooks/
```

### Examples of reuse over reimplementation:

❌ **Bad - Reimplementing**:
```tsx
// Creating a new button variant when one exists
export function MyCustomButton() {
  return <button className="custom-styles">Click</button>;
}
```

✅ **Good - Reusing**:
```tsx
// Using existing button with variant
import { Button } from "@turbostarter/ui-web/button";
export function MyFeature() {
  return <Button variant="outline">Click</Button>;
}
```

❌ **Bad - Duplicating logic**:
```tsx
// Writing custom date formatter
function formatDate(date: Date) {
  return date.toLocaleDateString();
}
```

✅ **Good - Using existing utility**:
```tsx
// Check if packages/shared has formatDate first
import { formatDate } from "@turbostarter/shared/utils";
```

❌ **Bad - Creating new API pattern**:
```tsx
// Inventing new error handling
if (!user) throw new Error("Not found");
```

✅ **Good - Following existing patterns**:
```tsx
// Copy pattern from packages/api/src/modules/admin/users/
if (!user) {
  return c.json({ error: "User not found" }, 404);
}
```

### Decision tree for new implementations:

```
Does similar functionality exist?
├─ YES → Reuse or extend it
│   └─ Can you extend the existing component/utility?
│       ├─ YES → Add props/options to existing code
│       └─ NO → Compose with existing primitives
└─ NO → Implement new, but:
    ├─ Follow established patterns from similar code
    ├─ Use existing primitives (UI components, utilities)
    └─ Make it reusable for future needs
```

### What this prevents:

- ❌ Duplicate button/input/modal components
- ❌ Multiple implementations of the same utility function
- ❌ Inconsistent API response formats
- ❌ Different auth/validation patterns across features
- ❌ Reimplementing data table patterns
- ❌ Creating custom hooks that already exist

### Required agent behavior:

Before implementing ANY feature:
1. **Search** the codebase for similar implementations
2. **Read** existing code in the same domain (admin, dashboard, auth)
3. **Ask** the user if you're unsure whether something exists
4. **Reuse** existing components, utilities, and patterns
5. **Only create new** when genuinely needed and nothing similar exists

**Optimization target**: Minimize code duplication and maximize consistency through reuse.

## Code Conventions

### TypeScript
- Write concise, technical TypeScript code
- Prefer functional and declarative patterns over classes
- Use interfaces over type aliases
- Avoid enums; use const objects with `as const` instead
- Descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`)
- Prefer iteration and modularization over code duplication

### React (Web)
- **Favor React Server Components** (default in Next.js App Router)
- Minimize `"use client"` directive - only when necessary for:
  - Browser APIs (localStorage, window)
  - Event handlers and interactivity
  - React hooks (useState, useEffect)
- Keep `use client` scoped to specific components; avoid at layout level
- Minimize client-side state (`useState`, `useEffect`)
- Wrap client components in `Suspense` with fallbacks
- Use dynamic imports for non-critical client components
- Use Tailwind CSS for styling; mobile-first responsive design
- Use Shadcn/Radix UI components from `@turbostarter/ui-web`
- Image optimization: WebP format, responsive sizes, lazy loading
- Focus on Web Vitals: LCP, CLS, FID
- Use `nuqs` for URL search param state management

### React Native (Mobile)
- Use safe area primitives: `SafeAreaProvider`, `SafeAreaView`, scroll variants
- Minimize `useState` and `useEffect`; prefer memoization
- Use `React.memo`, `useMemo`, `useCallback` for performance
- Expo Router for file-based navigation
- Use Expo SplashScreen for loading states
- Optimize images: `expo-image` package, WebP format
- Shared UI components from `@turbostarter/ui-mobile`

### File Organization
1. Exported component/function first
2. Sub-components below
3. Helper functions
4. Static content
5. Types/interfaces at bottom

### Error Handling
- Use guard clauses and early returns
- Expected errors: model as return values in Server Actions
- Unexpected errors: let error boundaries catch
- API: Use Zod for input validation
- Handle edge cases early in function logic

### Imports
- Use path aliases:
  - Apps: `~/` maps to `src/`
  - Packages: `@turbostarter/<package-name>`
- Group imports: external → internal → types
- Add imports and types explicitly; avoid `any` and unsafe casts

### Code Quality
- Adhere to existing formatting; do not reformat unrelated code
- Match existing code style and patterns
- Keep components small and modular
- When modifying multiple areas, prefer creating shared helpers in `packages/` to avoid duplication

### AI Agent Guidelines

When working autonomously, prioritize:

**What to do**:
- ✅ Prefer modifying existing patterns over creating new ones
- ✅ Keep changes minimal and scoped to the specific task
- ✅ Preserve existing functionality unless explicitly asked to change it
- ✅ Follow the established patterns in similar files
- ✅ Ask for clarification when requirements conflict with this document
- ✅ Use TypeScript's type system to catch errors early

**What to avoid**:
- ❌ Large refactors without explicit instruction
- ❌ Introducing breaking changes to APIs or schemas silently
- ❌ "Improving" code that isn't part of the task
- ❌ Making assumptions when requirements are ambiguous
- ❌ Adding dependencies without justification

**Optimize for**: Maintainability, type safety, and consistency with existing architecture over "clever" solutions.

## Key Workflows

### Adding a new API endpoint
1. Create module in `packages/api/src/modules/<feature>/`
2. Define router with Hono, add queries/mutations
3. Export router from module
4. Mount in `packages/api/src/index.ts`
5. Client auto-gets types via Hono RPC

### Database schema changes
1. Edit schema in `packages/db/src/schema/`
2. Generate migration: `pnpm with-env -F @turbostarter/db db:generate`
3. Review generated SQL in `packages/db/migrations/`
4. Apply: `pnpm with-env -F @turbostarter/db db:migrate`
5. Verify in Studio: `pnpm with-env -F @turbostarter/db db:studio`

### Adding a new dashboard page

**1. Define path in `apps/web/src/config/paths.ts`**:
```ts
// For user dashboard
dashboard: {
  user: {
    myFeature: `${DASHBOARD_PREFIX}/my-feature`,
  }
}

// For organization dashboard
organization: (slug: string) => ({
  myFeature: `${DASHBOARD_PREFIX}/${slug}/my-feature`,
})

// For admin dashboard
admin: {
  myResource: {
    index: `${ADMIN_PREFIX}/my-resource`,
    detail: (id: string) => `${ADMIN_PREFIX}/my-resource/${id}`,
  }
}
```

**2. Add sidebar menu item in layout**:
- User dashboard: `apps/web/src/app/[locale]/dashboard/(user)/layout.tsx`
- Organization: `apps/web/src/app/[locale]/dashboard/[organization]/layout.tsx`
- Admin: `apps/web/src/app/[locale]/admin/layout.tsx`

```ts
const menu = [
  {
    label: "platform", // or "account", "organization", "admin"
    items: [
      {
        title: "myFeature",        // i18n key from common.json
        href: pathsConfig.dashboard.user.myFeature,
        icon: Icons.YourIcon,      // from @turbostarter/ui-web/icons
      },
    ],
  },
];
```

**3. Create page file** with standard structure:

**Basic page** (`page.tsx`):
```tsx
import { getTranslation } from "@turbostarter/i18n/server";
import { getMetadata } from "~/lib/metadata";
import {
  DashboardHeader,
  DashboardHeaderTitle,
  DashboardHeaderDescription,
} from "~/modules/common/layout/dashboard/header";

export const generateMetadata = getMetadata({
  title: "common:myFeature",
  description: "dashboard:myFeature.description",
});

export default async function MyFeaturePage() {
  const { t } = await getTranslation({ ns: "dashboard" });

  return (
    <>
      <DashboardHeader>
        <div>
          <DashboardHeaderTitle>{t("myFeature.title")}</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            {t("myFeature.description")}
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>

      {/* Page content */}
    </>
  );
}
```

**Data table page** (admin/list pages):
```tsx
import { createSearchParamsCache, parseAsInteger } from "nuqs/server";
import { Suspense } from "react";
import { handle } from "@turbostarter/api/utils";
import { DataTableSkeleton } from "@turbostarter/ui-web/data-table/data-table-skeleton";
import { api } from "~/lib/api/server";

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(10),
  sort: getSortingStateParser().withDefault([{ id: "name", desc: false }]),
  q: parseAsString,
});

export default async function MyResourcesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { page, perPage, sort, ...filters } = searchParamsCache.parse(searchParams);

  const promise = handle(api.admin.myResources.$get)({
    query: { page: page.toString(), perPage: perPage.toString(), sort: JSON.stringify(sort) },
  });

  return (
    <>
      <DashboardHeader>
        <DashboardHeaderTitle>My Resources</DashboardHeaderTitle>
      </DashboardHeader>
      <Suspense fallback={<DataTableSkeleton columnCount={5} />}>
        <MyResourcesDataTable promise={promise} perPage={perPage} />
      </Suspense>
    </>
  );
}
```

**4. Add sub-navigation** (for settings-like pages):

Create `layout.tsx` with `SettingsNav` pattern:
```tsx
const LINKS = [
  { label: "general", href: pathsConfig.myFeature.general },
  { label: "advanced", href: pathsConfig.myFeature.advanced },
] as const;

export default async function MyFeatureLayout({ children }) {
  const { t } = await getTranslation();

  return (
    <>
      <DashboardHeader>
        <DashboardHeaderTitle>{t("myFeature.title")}</DashboardHeaderTitle>
        <div className="lg:hidden">
          <SettingsNav links={LINKS.map(link => ({ ...link, label: t(link.label) }))} />
        </div>
      </DashboardHeader>
      <div className="flex w-full gap-3">
        <div className="hidden w-96 lg:block">
          <div className="sticky top-[calc(var(--banner-height)+theme(spacing.6))]">
            <SettingsNav links={LINKS.map(link => ({ ...link, label: t(link.label) }))} />
          </div>
        </div>
        <div className="flex w-full flex-col gap-6">{children}</div>
      </div>
    </>
  );
}
```

**5. Add translations**:
- Common labels: `packages/i18n/translations/en/common.json`
- Page content: `packages/i18n/translations/en/dashboard.json` or `admin.json`

```json
{
  "myFeature": "My Feature",
  "myFeature.title": "Feature Title",
  "myFeature.description": "Feature description"
}
```

### Adding a new package to monorepo

**When to add a new package** (advanced):
- Only when functionality needs to be shared across multiple apps
- NOT for adding pages/components to a single app (use `apps/web/src/` instead)
- NOT for modifying existing packages

**Steps**:

1. **Generate package**:
```bash
turbo gen package
# Enter package name (e.g., "example" → @turbostarter/example)
```

2. **Enable fast refresh** in `apps/web/next.config.ts`:
```ts
const INTERNAL_PACKAGES = [
  // ...existing packages
  "@turbostarter/example",
];
```

3. **Define exports** in `package.json`:
```json
{
  "exports": {
    ".": "./src/index.ts",           // Default export
    "./client": "./src/client.ts",   // Client-only code
    "./server": "./src/server.ts"    // Server-only code
  }
}
```

**Why separate exports** (client/server pattern):
- Better tree-shaking (avoid bundling server code in client)
- Clear separation of concerns
- Used in existing packages like `@turbostarter/db` (has `/server` export)

**Usage**:
```tsx
// Default export
import { example } from "@turbostarter/example";

// Named exports (better tree-shaking)
import { clientFn } from "@turbostarter/example/client";
import { serverFn } from "@turbostarter/example/server";
```

### Adding a new app to monorepo

**When to add a new app** (very advanced):
- Only when you need multiple web apps sharing the same infrastructure
- Want to keep pulling updates from TurboStarter for the base `apps/web`
- Alternative: Create a separate repository (often simpler)

**Use git subtree workflow**:

1. **Create subtree** from `apps/web` (one-time setup):
```bash
git subtree split --prefix=apps/web --branch web-branch
```

2. **Add new app** using web as template:
```bash
# Example: create apps/ai-chat from apps/web template
git subtree add --prefix=apps/ai-chat origin web-branch --squash
```

3. **Update new app** when pulling TurboStarter updates:
```bash
# Pull latest from TurboStarter
git pull upstream main

# Update web-branch with latest apps/web
git subtree split --prefix=apps/web --branch web-branch
git push origin web-branch

# Pull updates into your new app
git subtree pull --prefix=apps/ai-chat origin web-branch --squash
```

**Why this approach**:
- Keeps new apps in sync with base web app structure
- Allows selective updates (can modify ai-chat independently)
- Maintains ability to pull upstream TurboStarter updates

### Multi-platform development
- Share logic in `packages/` to avoid duplication
- UI components: separate web (`ui-web`) and mobile (`ui-mobile`) packages
- API client works across web and mobile with same types

## Testing

- Test framework: Vitest
- Unit tests: co-located with source (`*.test.ts`)
- Run tests: `pnpm test` (uses Turbo caching)
- Watch mode: `pnpm test:projects:watch`

## Troubleshooting

### Common Issues

**Node/pnpm version mismatch**:
- Ensure Node >= 22.17.0: `node -v`
- Ensure pnpm 10.25.0: `pnpm -v`

**Services not available / connection refused**:
- Ensure Docker is running
- Start services: `pnpm services:start`
- Check logs: `pnpm services:logs`
- Verify status: `pnpm services:status`

**DATABASE_URL or env not loaded**:
- Create `.env` at repo root (not `.env.local`)
- Use `pnpm with-env` prefix for all DB commands
- Check `turbo.json` for required `globalEnv` variables

**Turbo or module resolution issues after refactors**:
- Clear caches: `pnpm clean`
- Reinstall: `pnpm install`

**Migration drift or conflicts**:
- Check status: `pnpm with-env -F @turbostarter/db db:check`
- Re-generate migration: `db:generate`
- Apply: `db:migrate`

## Performance Tips

- **Prefer targeted commands**: Use `pnpm --filter <app-or-package> <cmd>` to minimize work
- **Use `pnpm with-env`** whenever a command depends on environment variables
- **Leverage Turbo caching**: Commands like `build`, `lint`, `test` are cached
- **Web app**: Prefer React Server Components to reduce client bundle
- **Mobile app**: Memoize components and callbacks to prevent unnecessary re-renders

## Important Notes

- **Never commit `.env` files** - use `.env.example` as templates
- **Always use `pnpm with-env`** for database commands
- **Docker must be running** for local development (PostgreSQL)
- **Node.js >= 22.17.0** required
- **pnpm 10.25.0** is the package manager (enforced via `packageManager` field)
- Conventional Commits enforced via commitlint (husky hook)
- Workspace validation runs on `postinstall` via sherif
