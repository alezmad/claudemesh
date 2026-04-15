# claudemesh-cli v2 Pass 2 — Facade Pattern (referenced by Pass 1)

> ⚠️ **This document is a special case: it applies to BOTH Pass 1 and Pass 2.**
>
> The facade pattern is the main architectural improvement of v2 Pass 1 — it's the scalability + code distribution win you asked for. Pass 1 implements the full facade structure described here.
>
> However, some concrete examples in this document reference services that only exist in Pass 2 (`services/store`, `services/broker/sync-daemon`, etc.). When an example mentions a Pass 2-only service, treat the pattern as authoritative and substitute the Pass 1 service names.
>
> **Pass 1 services** (use the facade pattern here):
> auth, mesh, invite, broker, api, crypto, config, state (last-used cache only, not mesh state), device, clipboard, spawn, telemetry, health, update, i18n, lifecycle, logger.
>
> **Pass 2 services** (deferred):
> store (local SQLite source of truth), broker/sync-daemon (outbox/inbox), broker/peer-crypto (extended per-mesh long-term keys), anything in the shared-infrastructure spec.
>
> For the Pass 1 implementation target that lists exactly which services ship in Pass 1, see **`2026-04-11-cli-v2-pass1.md`**.

**Status:** Boundary canonical (applies to both Pass 1 and Pass 2)
**Created:** 2026-04-10
**Consolidated:** 2026-04-10 (post-reviews, no appendices)
**Companion to:** `2026-04-10-cli-v2-final-vision.md` (§3.2 defers to this document)
**Purpose:** Single source of truth for the UI↔services boundary. Specifies how facades work, what they contain, and how the ESLint + dependency-cruiser config enforces them. When a developer asks "can I import X from Y?", the answer is in here.

---

## Table of contents

1. The problem
2. The principle
3. Facade contract
4. Import policy (the hard rules)
5. Example facades (TypeScript, verified)
6. Directory structure
7. ESLint boundaries configuration
8. dependency-cruiser configuration
9. Type-only imports, dynamic imports, and re-exports
10. Testing facades and contract drift
11. What facades never expose
12. Async streams and cancellation
13. Errors and validation
14. FAQ

---

## 1. The problem

Without a facade, UI components end up importing whatever files happen to exist in a service folder:

```ts
// ui/screens/AuthScreen.tsx — bad
import { deviceCodeLogin } from '@/services/auth/device-code';
import { writeTokenFile } from '@/services/auth/token-store';
import { apiClient } from '@/services/api/client';
```

Three problems:

1. `AuthScreen` couples to specific implementation files — rename one and the UI breaks
2. `AuthScreen` has access to low-level operations (`writeTokenFile`) it should never call directly
3. `AuthScreen` has the raw `apiClient` and can make any API call anywhere

The fix is **one narrow door per service**, enforced by tooling, not naming conventions. UI and non-service consumers import from `services/<feature>/facade.ts` only. Every other file in the service is private.

## 2. The principle

> **A facade is a narrow, Promise-returning, plain-data interface that hides every implementation detail of a service. Consumers orchestrate business logic through facades. Services implement the logic behind them.**

Consequences we actively want:

- UI components are trivially testable with mock facades (no SQLite, no network, no filesystem)
- Services can be refactored freely without touching any consumer code
- The "what can UI do" surface is auditable by reading every `facade.ts` file
- Circular imports between UI and services become structurally impossible
- Boundary drift is a lint failure at CI, not a code review issue

## 3. Facade contract

### 3.1 What a facade MUST be

1. **A single `facade.ts` file per service**, at `services/<feature>/facade.ts`. Not a folder, not a subdirectory, not multiple files.
2. **Named exports only** — no default export, no namespace re-export
3. **Each export is either an async function or a pure data constant** (never a class, never a factory, never a singleton handle)
4. **Every parameter is a plain object** (`{ ... }`) — never a class instance, never a service handle
5. **Every return type is a plain object** constructed inline — never a pass-through of a service response
6. **Every input is Zod-validated** at the facade boundary before touching the service
7. **Every output is Zod-validated** before returning to the caller — the facade literally builds a new object and runs `.parse()` on it
8. **Errors are typed** — facades throw instances of domain-specific error classes from `services/<feature>/errors.ts`, never raw strings, never `ZodError` from input validation

### 3.2 What a facade MUST NOT do

1. **Never return a class instance** (even one defined in the same service)
2. **Never expose filesystem paths, URLs, or tokens** in return values — not even masked ones
3. **Never expose a database handle, HTTP client, or socket** — these are service-internal
4. **Never take a callback** for state — async/await only; for progress streams use async iterators with `AbortSignal`
5. **Never depend on React, Ink, or any UI library** — facades are framework-agnostic
6. **Never import from `ui/`, `cli/`, `commands/`, `mcp/`, or `entrypoints/`**
7. **Never use globals** — every dependency is injected at service boot time
8. **Never `export *` from another file** — every symbol is explicitly named (prevents accidental internal leakage)
9. **Never pass a service response through `...spread`** to the return object — every field is picked by name

### 3.3 Facade lifecycle

Facades themselves are stateless. They're free functions that call into the service. The service holds state (database connection, HTTP client, lifecycle); the facade is the stateless adapter.

```ts
// services/auth/index.ts — service boot (called once from entrypoints)
import { createAuthService } from './implementation';
import { getTokenStore } from './token-store';
import { getApiClient } from '@/services/api';

let instance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!instance) {
    instance = createAuthService({
      tokenStore: getTokenStore(),
      apiClient: getApiClient(),
    });
  }
  return instance;
}

// NOTE: no `export * from './device-code'`, no `export { ... } from './internal'`.
// Only `getAuthService` is public via index.ts, and only services/* can import it.
```

```ts
// services/auth/facade.ts
import { z } from 'zod';
import { getAuthService } from './index';
import { InvalidTokenError, DeviceCodeTimeoutError, AuthNetworkError } from './errors';

// ...schemas and facade functions below
```

UI never imports `getAuthService` — only the facade.

## 4. Import policy (the hard rules)

This is the stack of allow-lists. Every rule is enforced by ESLint boundaries + dependency-cruiser. Any violation fails CI.

| Consumer | May import from |
|---|---|
| `entrypoints/` | `cli/`, `commands/`, `ui/`, `mcp/`, `service-facade/`, `utils/`, `types/`, `constants/`, `locales/`, `templates/`, `migrations/` |
| `commands/` | `cli/`, `ui/`, **`service-facade/` only**, `utils/`, `types/`, `constants/`, `locales/` |
| `ui/` | `ui/`, **`service-facade/` only**, `utils/`, `types/`, `constants/`, `locales/` |
| `cli/` (non-Ink I/O) | **`service-facade/` only**, `utils/`, `types/`, `constants/`, `locales/` |
| `mcp/` | **`service-facade/` only**, `templates/`, `utils/`, `types/`, `constants/`, `locales/` |
| `service-facade` (a service's own facade) | its own `service-internal`, other services' `service-facade`, `utils/`, `types/`, `constants/`, `locales/` |
| `service-internal` (service implementation files) | its own `service-internal`, its own `service-facade` (rare), other services' `service-facade`, `templates/`, `utils/`, `types/`, `constants/`, `locales/` |
| `service-index` (factory barrel) | its own `service-internal`, `utils/`, `types/`, `constants/`, `locales/` |
| `service-test` | its own `service-internal`, its own `service-facade`, any `service-facade` (for integration), `utils/`, `types/`, `constants/`, `templates/` |
| `templates/` | `utils/`, `types/`, `constants/` |
| `locales/` | `types/` |
| `utils/` | `types/` |
| `constants/` | (nothing) |
| `types/` | (nothing, except other `types/`) |
| `migrations/` | own `service-index`, `utils/`, `types/`, `constants/` |

**Key tightenings from review:**

- **`commands` uses facades only.** Commands go through facades like UI does. If a command needs deeper access, the facade is missing a function — extend the facade, don't bypass it.
- **`entrypoints` no longer gets `service-internal` access.** Entrypoints call `commands`, which call facades.
- **`mcp` now uses facades only** (no `service-index`). MCP tool handlers are not magic — they go through the same narrow interfaces as commands. If a tool needs cross-service composition beyond what a single facade exposes, it composes multiple facades.
- **`service-facade` can import from other services' `service-facade`** (cross-service facade composition). Service-to-service calls go facade→facade, not through `index.ts`. This removes the `service-index` cross-service path entirely.
- **`service-index` is downgraded** to a factory barrel that only exposes `getXxxService()` and is imported only by `entrypoints/cli.ts` for DI wiring and by its own service's internals. No other layer imports `service-index`.
- **`migrations/` no longer gets `service-internal` access.** Migrations work against `service-index` (its own service only, through the factory) and the raw database connection. Deep data surgery happens through typed helpers in the service's internals, not directly.

**The only consumers that touch `service-internal` are**:
- The service itself (its own folder)
- The service's tests
- The service's `facade.ts` and `index.ts` files (by definition)

## 5. Example facades (TypeScript, verified)

### 5.1 Auth facade — with input AND output validation

```ts
// services/auth/facade.ts

import { z } from 'zod';
import { getAuthService } from './index';
import {
  InvalidTokenError,
  DeviceCodeTimeoutError,
  AuthNetworkError,
  toDomainError,
} from './errors';

// ---- Input schemas ----

const LoginWithTokenInputSchema = z.object({
  token: z.string().regex(/^cm_(session|pat)_[a-z0-9]{32,}$/, 'malformed token'),
});

// ---- Output schemas ----

const UserSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  email: z.string().email(),
}).strict();

const LoginResultSchema = z.object({
  user: UserSchema,
}).strict();

const WhoAmIResultSchema = z.object({
  signed_in: z.boolean(),
  user: UserSchema.nullable(),
  token_source: z.enum(['device_code', 'pat', 'env']).nullable(),
}).strict();

const LogoutResultSchema = z.object({
  server_revoked: z.boolean(),
}).strict();

// ---- Exported types ----

export type LoginResult = z.infer<typeof LoginResultSchema>;
export type WhoAmIResult = z.infer<typeof WhoAmIResultSchema>;
export type LogoutResult = z.infer<typeof LogoutResultSchema>;

// ---- Facade functions ----

/**
 * Start the device-code flow. Opens browser, polls until user approves or denies.
 * @throws DeviceCodeTimeoutError if the user doesn't respond in 10 minutes
 * @throws AuthNetworkError if claudemesh.com is unreachable
 */
export async function loginWithDeviceCode(): Promise<LoginResult> {
  try {
    const result = await getAuthService().startDeviceCodeFlow();
    // Build output explicitly — no spread, no pass-through
    return LoginResultSchema.parse({
      user: {
        id: result.user.id,
        display_name: result.user.display_name,
        email: result.user.email,
      },
    });
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Login using a PAT or session token from explicit input.
 * @throws InvalidTokenError if the token format is wrong
 * @throws AuthNetworkError if the server rejects or is unreachable
 */
export async function loginWithToken(input: unknown): Promise<LoginResult> {
  // Validate input BEFORE touching the service
  const parsed = LoginWithTokenInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidTokenError('malformed token format');
  }
  try {
    const result = await getAuthService().loginWithToken(parsed.data.token);
    return LoginResultSchema.parse({
      user: {
        id: result.user.id,
        display_name: result.user.display_name,
        email: result.user.email,
      },
    });
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Check current auth state. Never throws.
 */
export async function whoAmI(): Promise<WhoAmIResult> {
  try {
    const state = await getAuthService().getCurrentState();
    return WhoAmIResultSchema.parse({
      signed_in: state.signed_in,
      user: state.user
        ? {
            id: state.user.id,
            display_name: state.user.display_name,
            email: state.user.email,
          }
        : null,
      token_source: state.token_source,
    });
  } catch {
    return WhoAmIResultSchema.parse({
      signed_in: false,
      user: null,
      token_source: null,
    });
  }
}

/**
 * Revoke the current session server-side and clear local credentials.
 * Best-effort on server; always clears local.
 */
export async function logout(): Promise<LogoutResult> {
  try {
    const result = await getAuthService().logout();
    return LogoutResultSchema.parse({
      server_revoked: result.server_revoked,
    });
  } catch {
    return LogoutResultSchema.parse({ server_revoked: false });
  }
}
```

**Key properties verified in this example**:
- `.strict()` on every schema prevents extra fields from passing through (eliminates the "class instance with matching fields" bypass)
- Input is validated BEFORE the service call
- Output is built explicitly, field by field — no spread, no pass-through
- Every branch catches errors and maps via `toDomainError`
- Zod errors never escape the facade — they're mapped to domain errors

### 5.2 Error mapping helper — preserves cause + logs unmapped bugs

```ts
// services/auth/errors.ts

import { ZodError } from 'zod';
import { logger } from '@/services/logger/facade'; // structured logger

export class InvalidTokenError extends Error {
  readonly code = 'AUTH_INVALID_TOKEN';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause) this.cause = options.cause;
  }
}

export class DeviceCodeTimeoutError extends Error {
  readonly code = 'AUTH_DEVICE_CODE_TIMEOUT';
  constructor(cause?: unknown) {
    super('device code flow timed out');
    if (cause) this.cause = cause;
  }
}

export class AuthNetworkError extends Error {
  readonly code = 'AUTH_NETWORK';
  constructor(cause?: unknown) {
    super('auth network error');
    if (cause) this.cause = cause;
  }
}

/**
 * Unmapped errors are real bugs. They land in the UnmappedError class and
 * get logged with full stack for telemetry, so they don't disappear into
 * generic AuthNetworkError (which would hide root causes).
 */
export class UnmappedError extends Error {
  readonly code = 'UNMAPPED';
  constructor(cause: unknown) {
    super('unmapped internal error');
    this.cause = cause;
  }
}

/**
 * Map any thrown value into a typed domain error.
 *
 * Contract:
 * - Domain errors pass through unchanged
 * - ZodError → InvalidTokenError with original cause attached
 * - Node network errors (ENOTFOUND, ECONNREFUSED, etc.) → AuthNetworkError
 * - EVERYTHING ELSE → UnmappedError (explicitly logged as a bug)
 *
 * Unmapped errors are logged at ERROR level with the full stack trace so
 * they surface in telemetry instead of being silently categorized as
 * network errors. This fixes the observability gap where a null pointer
 * bug would appear as "network error" in logs.
 */
export function toDomainError(err: unknown): Error {
  // Domain errors pass through unchanged
  if (err instanceof InvalidTokenError) return err;
  if (err instanceof DeviceCodeTimeoutError) return err;
  if (err instanceof AuthNetworkError) return err;
  if (err instanceof UnmappedError) return err;

  // Zod validation failures → typed input error, preserving the original for logs
  if (err instanceof ZodError) {
    const mapped = new InvalidTokenError('schema validation failed', { cause: err });
    logger.warn('facade: zod validation failed', { errors: err.errors, mapped: mapped.code });
    return mapped;
  }

  // Node network errors → AuthNetworkError, preserving the original
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'EAI_AGAIN'
    ) {
      return new AuthNetworkError(err);
    }
  }

  // Anything else is a bug. Log it with full context and return an UnmappedError.
  // This prevents programmer bugs from being silently miscategorized.
  logger.error('facade: unmapped error (likely a bug)', {
    error: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
    facade: 'auth',
  });
  return new UnmappedError(err);
}
```

**Key change from v1**: the previous implementation collapsed everything unknown into `AuthNetworkError`. A null pointer exception in the service would surface to the UI as "network error" and telemetry would never flag it as a bug. The new `UnmappedError` class catches these with explicit logging at ERROR level, so real bugs show up in logs and can be tracked by telemetry.

Every service's `errors.ts` follows this pattern: domain errors + `UnmappedError` + `toDomainError` helper that logs unmapped cases.

### 5.3 Mesh facade (summary form)

```ts
// services/mesh/facade.ts

import { z } from 'zod';
import { getMeshService } from './index';
import { MeshNotFoundError, SlugCollisionError, PermissionDeniedError, toDomainError } from './errors';

const MeshSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  kind: z.enum(['personal', 'shared_owner', 'shared_guest']),
  peer_count: z.number().int().nonnegative(),
  peers_online: z.number().int().nonnegative(),
  last_used_at: z.number().int().nullable(),
}).strict();

const MeshListResultSchema = z.object({
  meshes: z.array(MeshSummarySchema),
  last_used_slug: z.string().nullable(),
}).strict();

const PublishMeshResultSchema = z.object({
  slug: z.string(),
  invite_url: z.string().url(),
}).strict();

export type MeshSummary = z.infer<typeof MeshSummarySchema>;
export type MeshListResult = z.infer<typeof MeshListResultSchema>;
export type PublishMeshResult = z.infer<typeof PublishMeshResultSchema>;

export async function createMesh(input: unknown): Promise<MeshSummary> {
  const parsed = z.object({
    name: z.string().min(1).max(128),
    slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  }).safeParse(input);
  if (!parsed.success) throw new MeshNotFoundError('invalid create input');
  try {
    const r = await getMeshService().create(parsed.data);
    return MeshSummarySchema.parse({
      slug: r.slug, name: r.name, kind: r.kind,
      peer_count: r.peer_count, peers_online: r.peers_online,
      last_used_at: r.last_used_at,
    });
  } catch (err) { throw toDomainError(err); }
}

export async function listMeshes(): Promise<MeshListResult> {
  try {
    const r = await getMeshService().list();
    return MeshListResultSchema.parse({
      meshes: r.meshes.map(m => ({
        slug: m.slug, name: m.name, kind: m.kind,
        peer_count: m.peer_count, peers_online: m.peers_online,
        last_used_at: m.last_used_at,
      })),
      last_used_slug: r.last_used_slug,
    });
  } catch (err) { throw toDomainError(err); }
}

export async function publishMesh(input: unknown): Promise<PublishMeshResult> {
  const parsed = z.object({ slug: z.string() }).safeParse(input);
  if (!parsed.success) throw new MeshNotFoundError('invalid publish input');
  try {
    const r = await getMeshService().publish(parsed.data);
    return PublishMeshResultSchema.parse({ slug: r.slug, invite_url: r.invite_url });
  } catch (err) { throw toDomainError(err); }
}

// ...joinMeshByInvite, renameMesh, leaveMesh, resolveLaunchTarget follow same pattern
```

### 5.4 Clipboard facade (even trivial services get a facade)

```ts
// services/clipboard/facade.ts

import { z } from 'zod';
import { getClipboardService } from './index';

const DetectInviteResultSchema = z.object({
  has_invite: z.boolean(),
  mesh_slug: z.string().nullable(),
  url: z.string().url().nullable(),
}).strict();

export type DetectInviteResult = z.infer<typeof DetectInviteResultSchema>;

/**
 * Never returns raw clipboard content — only the detected invite metadata.
 * Prevents arbitrary clipboard content from flowing into UI state (privacy).
 */
export async function detectInviteInClipboard(): Promise<DetectInviteResult> {
  try {
    const r = await getClipboardService().detectInvite();
    return DetectInviteResultSchema.parse({
      has_invite: r.has_invite,
      mesh_slug: r.mesh_slug ?? null,
      url: r.url ?? null,
    });
  } catch {
    return DetectInviteResultSchema.parse({
      has_invite: false,
      mesh_slug: null,
      url: null,
    });
  }
}
```

Yes, this is more code than `getClipboardService().detectInvite()` would be. That's the point: the facade prevents UI from ever learning that `clipboardService` exists, and prevents the implementation from leaking raw clipboard content through the boundary.

## 6. Directory structure

```
apps/cli-v2/src/services/auth/
├── client.ts              # private — HTTP calls to /api/auth/cli/*
├── device-code.ts         # private — device-code flow orchestration
├── pat.ts                 # private — PAT parsing and validation
├── token-store.ts         # private — ~/.claudemesh/auth.json R/W
├── refresh.ts             # private — silent re-auth
├── implementation.ts      # private — assembles the service from parts
├── schemas.ts             # private — internal Zod schemas
├── errors.ts              # private — domain error classes + toDomainError
├── types.ts               # private — internal types
├── index.ts               # PUBLIC (for other services) — exports getAuthService()
├── facade.ts              # PUBLIC (for ui/commands/cli/mcp) — narrow facade
├── facade.test.ts         # facade contract test (verifies no tokens leak)
└── auth.test.ts           # internal unit tests
```

**Rules for this tree**:

- `index.ts` contains only **named exports of the service factory/getter**. It must not `export *`, must not re-export internal files, must not expose types for internal implementation details.
- `facade.ts` is a single file. It is never a folder. It never has siblings named `facade.*.ts`.
- Internal files (`client.ts`, `device-code.ts`, etc.) can import each other freely within the service.
- Cross-service access is through each service's `index.ts`, not through internals.
- Nested folders inside a service (e.g. `services/mesh/subsystem/`) are allowed, but every file in them is classified as `service-internal` regardless of depth.

## 7. ESLint boundaries configuration

This is the enforced config. It has been reviewed for all the bypass paths found in the initial draft: shallow globs, nested files, test overlap, re-exports, dynamic imports, and type-only imports.

```js
// apps/cli-v2/.eslintrc.cjs
module.exports = {
  plugins: ['boundaries', 'claudemesh-custom'], // claudemesh-custom is an in-repo ESLint plugin
  settings: {
    'boundaries/elements': [
      // Entry points — process entry
      { type: 'entrypoints', pattern: 'src/entrypoints/*.{ts,tsx,mts,cts}' },

      // Top-level layers
      { type: 'cli',      pattern: 'src/cli/**/*.{ts,tsx,mts,cts}' },
      { type: 'commands', pattern: 'src/commands/**/*.{ts,tsx,mts,cts}' },
      { type: 'ui',       pattern: 'src/ui/**/*.{ts,tsx,mts,cts}' },
      { type: 'mcp',      pattern: 'src/mcp/**/*.{ts,tsx,mts,cts}' },

      // Service layers — order matters: test > facade > index > internal
      // Test pattern MUST come first so *.test.ts files classify as service-test,
      // not service-internal.
      // Facade pattern MUST cover both facade.ts (single file) AND facade/*.ts
      // (folder form) to prevent the facade-as-folder bypass.
      { type: 'service-test',     pattern: 'src/services/*/**/*.test.{ts,tsx,mts,cts}' },
      { type: 'service-facade',   pattern: [
        'src/services/*/facade.{ts,tsx,mts,cts}',
        'src/services/*/facade/**/*.{ts,tsx,mts,cts}',  // fallback if someone uses facade/ folder
      ]},
      { type: 'service-index',    pattern: 'src/services/*/index.{ts,tsx,mts,cts}' },
      { type: 'service-internal', pattern: 'src/services/*/**/*.{ts,tsx,mts,cts}' },

      // Pure / data layers
      { type: 'templates', pattern: 'src/templates/**/*.{ts,tsx,mts,cts}' },
      { type: 'locales',   pattern: 'src/locales/**/*.{ts,tsx,mts,cts}' },
      { type: 'utils',     pattern: 'src/utils/**/*.{ts,tsx,mts,cts}' },
      { type: 'types',     pattern: 'src/types/**/*.{ts,tsx,mts,cts}' },
      { type: 'constants', pattern: 'src/constants/**/*.{ts,tsx,mts,cts}' },
      { type: 'migrations', pattern: 'src/migrations/**/*.{ts,tsx,mts,cts}' },
    ],
    'boundaries/include': ['src/**/*.{ts,tsx,mts,cts}'],
  },
  rules: {
    // Hard boundary rule — facades-only for all consumer layers
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        // entrypoints compose the application; they need service-index for DI wiring
        // but never touch service-internal.
        { from: 'entrypoints', allow: [
          'cli', 'commands', 'ui', 'mcp',
          'service-facade', 'service-index',
          'templates', 'locales', 'utils', 'types', 'constants', 'migrations',
        ] },

        // UI: facades only.
        { from: 'ui', allow: [
          'ui', 'service-facade',
          'locales', 'utils', 'types', 'constants',
        ] },

        // Commands: facades only (no service-index, no service-internal).
        { from: 'commands', allow: [
          'cli', 'ui', 'service-facade',
          'locales', 'utils', 'types', 'constants',
        ] },

        // CLI (non-Ink I/O plumbing): facades only.
        { from: 'cli', allow: [
          'service-facade',
          'locales', 'utils', 'types', 'constants',
        ] },

        // MCP: facades only (TIGHTENED — no longer gets service-index).
        // Cross-service composition happens by importing from other services' facades.
        { from: 'mcp', allow: [
          'service-facade',
          'templates', 'locales', 'utils', 'types', 'constants',
        ] },

        // A service's facade can use its own internals + OTHER services' facades
        // (cross-service facade composition). No longer uses service-index for
        // cross-service calls.
        { from: 'service-facade', allow: [
          'service-internal', 'service-facade',
          'locales', 'utils', 'types', 'constants',
        ] },

        // A service's internals can freely use each other + other services' facades.
        { from: 'service-internal', allow: [
          'service-internal', 'service-facade',
          'templates', 'locales', 'utils', 'types', 'constants',
        ] },

        // A service's index.ts is a factory barrel. It imports its own internals
        // and exposes getXxxService(). It does NOT re-export anything else.
        // Other services do not import from this — use service-facade for cross-
        // service calls.
        { from: 'service-index', allow: [
          'service-internal',
          'locales', 'utils', 'types', 'constants',
        ] },

        // Tests can import their own service freely; may also import OTHER services'
        // facades for integration tests (not their internals).
        { from: 'service-test', allow: [
          'service-internal', 'service-facade', 'service-index',
          'service-test',
          'templates', 'locales', 'utils', 'types', 'constants',
        ] },

        // Pure layers
        { from: 'templates', allow: ['utils', 'types', 'constants'] },
        { from: 'locales',   allow: ['types'] },
        { from: 'utils',     allow: ['types'] },
        { from: 'constants', allow: [] },
        { from: 'types',     allow: ['types'] },

        // Migrations: only their own service's index (for the DI factory) and
        // internal (for deep data surgery). No cross-service internals.
        { from: 'migrations', allow: [
          'service-index', 'service-internal',
          'utils', 'types', 'constants',
        ] },
      ],
    }],

    // Ban `export *` globally — closes the bulk re-export loophole.
    'no-restricted-syntax': [
      'error',
      {
        selector: "ExportAllDeclaration",
        message: "`export *` is forbidden. Use named exports.",
      },
    ],

    // Custom in-repo rule: ban named re-exports from `./internal` paths in
    // service index.ts files. Only `getXxxService` getters can be exported.
    'claudemesh-custom/no-index-reexport-internal': 'error',

    // Custom in-repo rule: ban `import type` and value imports from internal
    // service files across layer boundaries. Complements boundaries plugin
    // which by default doesn't distinguish value vs type imports.
    'claudemesh-custom/type-imports-count-as-edges': 'error',

    // Custom in-repo rule: use ts-morph AST to find all dynamic `import()`
    // calls with non-literal arguments targeting the services/ path. Blocks
    // `await import(var)` as well as string literals.
    'claudemesh-custom/no-dynamic-service-imports': 'error',

    // Invert no-restricted-imports to an allowlist: from consumer layers,
    // block EVERYTHING under services/*/ except facade.*.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              // Block direct imports to any internal service file from consumer layers
              '**/services/*/!(facade)**',
              '**/services/*/!(facade).*',
              // Block imports from index.ts unless explicitly from entrypoints
              '**/services/*/index',
              '**/services/*/index.*',
            ],
            message: 'Import from services/<name>/facade.ts only. These files are internal.',
          },
        ],
      },
    ],
  },
  overrides: [
    // Service internals, facades, and tests bypass the blocklist (they need each other)
    {
      files: [
        'src/services/*/**',
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    // Entrypoints can import service-index for DI wiring
    {
      files: ['src/entrypoints/*'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['**/services/*/!(facade|index)**'], message: 'Entrypoints use facade or index only.' },
          ],
        }],
      },
    },
    // Tests can mock internals
    {
      files: ['tests/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
```

### Custom in-repo ESLint rules

The three `claudemesh-custom/*` rules above are implemented in `tools/eslint-plugin-claudemesh/`:

#### `no-index-reexport-internal`

Parses each `services/*/index.ts` file and rejects any `ExportNamedDeclaration` that references a local file (starting with `./`) unless the exported symbol is a factory getter matching the pattern `get*Service`.

```ts
// services/auth/index.ts — ALLOWED
export { getAuthService } from './implementation';

// services/auth/index.ts — REJECTED
export { deviceCodeLogin } from './device-code'; // leaks internal
export { tokenStore } from './token-store';       // leaks internal
```

This closes the named-re-export loophole that `no-restricted-syntax: ExportAllDeclaration` alone didn't catch.

#### `type-imports-count-as-edges`

By default, `eslint-plugin-boundaries` may treat `import type { Foo } from '...'` as a free pass because TypeScript erases type-only imports at compile time. But type imports create source-level coupling — renaming an internal type breaks UI code that imported it. This rule marks type imports as full dependency edges for boundary enforcement.

Implementation: a simple AST walker that reports any `ImportDeclaration` with `importKind === 'type'` where the source path crosses a layer boundary, just like a value import would.

#### `no-dynamic-service-imports`

Uses `ts-morph` or the TypeScript compiler API to walk every `ImportExpression` (dynamic `import()` call) in the source tree. Rejects any call whose argument is:

- Not a string literal
- A string literal matching `services/*/[^f]` (anything other than `facade.*`)
- A template literal
- A function call returning a string

```ts
// REJECTED — non-literal argument
const p = 'services/auth/client';
await import(p);

// REJECTED — template literal
await import(`services/${name}/client`);

// REJECTED — string literal pointing to internal file
await import('@/services/auth/client');

// ALLOWED — string literal pointing to facade
await import('@/services/auth/facade');
```

The rule runs as part of the ESLint lint pass. No separate build-time scanner is needed — everything is enforced at CI via ESLint.

### Key fixes from review (second round)

- **Pattern order is verified** by a classification test that asserts `services/auth/facade.ts` → `service-facade`, `services/auth/client.ts` → `service-internal`, `services/auth/foo.test.ts` → `service-test` before the rules run.
- **`facade/` folder bypass closed**: the `service-facade` pattern is an array of two globs, the second catches `services/*/facade/**/*.ts`.
- **`commands`, `mcp` no longer reach `service-index`**: both use facades only. MCP cross-service composition goes through other services' facades.
- **`service-facade` imports other services' `service-facade`, not `service-index`**: this makes `service-index` a pure DI factory consumed only by entrypoints.
- **Named re-export loophole closed** via `claudemesh-custom/no-index-reexport-internal`.
- **Dynamic import loophole closed** via `claudemesh-custom/no-dynamic-service-imports` using AST walking, not regex.
- **Type-only imports count as edges** via `claudemesh-custom/type-imports-count-as-edges`.
- **`no-restricted-imports` inverted to allowlist**: consumer layers are blocked from importing ANY file under `services/*/` except `facade.*`. Overrides for entrypoints (which can also use index) and service-internal files (which can import each other).
- **Migrations` tightened** to only their own service (not cross-service internals).

## 8. dependency-cruiser configuration

Belt-and-suspenders folder-level rules for anything the ESLint config might miss.

```js
// apps/cli-v2/dependency-cruiser.config.js
module.exports = {
  forbidden: [
    {
      name: 'ui-only-facades',
      comment: 'UI may only import from services/<name>/facade.ts, never internals or index.',
      severity: 'error',
      from: { path: '^src/ui' },
      to: {
        path: '^src/services/[^/]+/',
        pathNot: '^src/services/[^/]+/facade\\.(ts|tsx|mts|cts)$',
      },
    },
    {
      name: 'commands-only-facades',
      comment: 'Commands may only import from services/<name>/facade.ts.',
      severity: 'error',
      from: { path: '^src/commands' },
      to: {
        path: '^src/services/[^/]+/',
        pathNot: '^src/services/[^/]+/facade\\.(ts|tsx|mts|cts)$',
      },
    },
    {
      name: 'cli-only-facades',
      comment: 'CLI I/O layer may only import from services/<name>/facade.ts.',
      severity: 'error',
      from: { path: '^src/cli' },
      to: {
        path: '^src/services/[^/]+/',
        pathNot: '^src/services/[^/]+/facade\\.(ts|tsx|mts|cts)$',
      },
    },
    {
      name: 'mcp-no-cross-internal',
      comment: 'MCP tools may cross services via index.ts, not via internals.',
      severity: 'error',
      from: { path: '^src/mcp' },
      to: {
        path: '^src/services/[^/]+/',
        pathNot: '^src/services/[^/]+/(facade|index)\\.(ts|tsx|mts|cts)$',
      },
    },
    {
      name: 'cli-no-ui',
      comment: 'Non-Ink I/O plumbing must not depend on Ink.',
      severity: 'error',
      from: { path: '^src/cli' },
      to: { path: '^src/ui' },
    },
    {
      name: 'services-no-ui',
      comment: 'Services must not depend on Ink or commands.',
      severity: 'error',
      from: { path: '^src/services' },
      to: { path: '^src/(ui|commands|cli)' },
    },
    {
      name: 'utils-pure',
      comment: 'Utils must not import from effectful layers.',
      severity: 'error',
      from: { path: '^src/utils' },
      to: { path: '^src/(services|ui|commands|cli|mcp|entrypoints)' },
    },
    {
      name: 'types-pure',
      comment: 'Types must not import from anything except other types.',
      severity: 'error',
      from: { path: '^src/types' },
      to: { pathNot: '^src/types' },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies anywhere.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: './tsconfig.json' },
    includeOnly: '^src',
  },
};
```

## 9. Type-only imports, dynamic imports, and re-exports

### 9.1 Type-only imports

Type-only imports (`import type { X } from '...'`) **do count as dependency edges** for boundary purposes. The rationale: a type import creates coupling. If the internal file's types change, the UI breaks. That's exactly what facades exist to prevent.

ESLint boundaries treats `import type` as equivalent to `import` for classification purposes. dependency-cruiser is configured with `tsPreCompilationDeps: true` which includes type-only edges.

### 9.2 Dynamic imports — AST-based enforcement

`await import('computed-path')` cannot be statically analyzed with regex. Variable arguments (`const p = ...; await import(p)`) and template literals (`` await import(`services/${name}/client`) ``) would escape any regex-based check.

**Enforcement**: the custom ESLint rule `claudemesh-custom/no-dynamic-service-imports` uses the TypeScript compiler API (via `ts-morph` or `@typescript-eslint/parser`) to walk every `CallExpression` whose callee is the `import` keyword (the `ImportExpression` node type).

```ts
// tools/eslint-plugin-claudemesh/rules/no-dynamic-service-imports.ts
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

export const noDynamicServiceImports: TSESLint.RuleModule<'illegalDynamicImport', []> = {
  meta: {
    type: 'problem',
    messages: {
      illegalDynamicImport:
        'Dynamic import of a service path is forbidden. Use the facade directly: {{hint}}',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportExpression(node: TSESTree.ImportExpression) {
        const arg = node.source;

        // Case 1: non-literal argument (variable, function call, template with expressions)
        if (arg.type !== 'Literal' || typeof arg.value !== 'string') {
          // Check if this file is inside src/services/ — those are allowed
          // to use dynamic imports freely within their own service
          const filename = context.filename;
          if (filename.includes('/src/services/')) return;

          context.report({
            node,
            messageId: 'illegalDynamicImport',
            data: { hint: 'dynamic import arguments must be string literals' },
          });
          return;
        }

        // Case 2: literal pointing to a service internal
        const path = arg.value;
        const match = path.match(/services\/([^/]+)\/(.+)$/);
        if (!match) return;

        const [, serviceName, rest] = match;
        // Allow only imports of the facade or types
        if (rest === 'facade' || rest.startsWith('facade.') || rest.startsWith('facade/')) return;
        if (rest === 'types' || rest.startsWith('types.')) return;

        context.report({
          node,
          messageId: 'illegalDynamicImport',
          data: {
            hint: `use '@/services/${serviceName}/facade' instead`,
          },
        });
      },
    };
  },
};
```

This catches:
- `await import('services/auth/client')` — literal pointing to internal
- `await import(computedVar)` — non-literal argument from outside the service
- `` await import(`services/${x}/y`) `` — template literal with expression

Consumers inside `src/services/` can still use dynamic imports freely within their own service (lazy loading, plugin patterns). The rule only fires when a non-service file tries to reach into a service folder dynamically.

**No regex in build.ts** — the entire enforcement is via ESLint's CI pass, using TypeScript's AST.

### 9.3 Re-exports — named re-exports also banned

`export *` is banned project-wide via `no-restricted-syntax: ExportAllDeclaration`. But that only closes the bulk-leak path — **named re-exports from sibling internals are also banned** via the custom rule `claudemesh-custom/no-index-reexport-internal`.

**Rules for `services/<name>/index.ts`**:

- ALLOWED: `export { getAuthService } from './implementation';` — but only if the exported name matches `/^get\w+Service$/`, confirming it's a factory getter
- REJECTED: `export { deviceCodeLogin } from './device-code';` — leaks an internal function
- REJECTED: `export { writeTokenFile } from './token-store';` — leaks a low-level helper
- REJECTED: `export { AuthService } from './types';` — leaks an implementation type (use explicit imports from `./types` if needed by internals, and expose via the facade)

**Rules for `services/<name>/facade.ts`**:

- Exports are named only — no `export *`, no namespace re-export
- Every exported symbol is either an `async function` or a `const` data value
- No re-exports at all — the facade BUILDS output from scratch via Zod parsing, never passes through

**Rules for internal files** (`services/<name>/*.ts` except `facade.ts` and `index.ts`):

- Can import from each other freely within the same service folder
- Can `export` named symbols to sibling files in the same service
- Cannot `export` to non-sibling consumers except via the facade or the factory getter in `index.ts`

The custom rule enforces these at CI. Any violation fails the PR with a clear error message pointing to the offending export.

## 10. Testing facades and contract drift

### 10.1 Facade contract test

Every service's `facade.test.ts` verifies the contract holds:

```ts
// services/auth/facade.test.ts

import { describe, it, expect, vi } from 'vitest';
import * as facade from './facade';
import { getAuthService } from './index';

vi.mock('./index', () => ({
  getAuthService: vi.fn(),
}));

describe('auth facade contract', () => {
  it('loginWithDeviceCode returns only user info — no token leaks', async () => {
    vi.mocked(getAuthService).mockReturnValue({
      startDeviceCodeFlow: vi.fn().mockResolvedValue({
        user: { id: 'u1', display_name: 'Alejandro', email: 'a@b.c' },
        token: 'cm_session_SECRETSECRETSECRETSECRETSECRETSE',
        raw_response: { headers: {} },
      }),
    } as any);

    const result = await facade.loginWithDeviceCode();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('cm_session_');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('raw_response');
    expect(result).toEqual({
      user: { id: 'u1', display_name: 'Alejandro', email: 'a@b.c' },
    });
  });

  it('whoAmI never throws even when service fails', async () => {
    vi.mocked(getAuthService).mockReturnValue({
      getCurrentState: vi.fn().mockRejectedValue(new Error('boom')),
    } as any);

    await expect(facade.whoAmI()).resolves.toBeDefined();
  });

  it('loginWithToken rejects malformed token with InvalidTokenError', async () => {
    const { InvalidTokenError } = await import('./errors');
    await expect(facade.loginWithToken({ token: 'not-a-token' }))
      .rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('every exported function is async (returns a Promise)', () => {
    for (const key of Object.keys(facade)) {
      const v = (facade as any)[key];
      if (typeof v === 'function') {
        const r = v({});
        expect(r).toBeInstanceOf(Promise);
        r.catch(() => {}); // swallow test-only rejection
      }
    }
  });
});
```

### 10.1.5 Boundaries classification test (verify pattern precedence)

`eslint-plugin-boundaries` pattern resolution is implementation-defined — not all versions guarantee "first match wins" or "most specific glob wins." Before trusting the config, we verify classification empirically:

```ts
// tests/unit/facade-boundaries-classification.test.ts

import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

const linter = new ESLint({ overrideConfigFile: '.eslintrc.cjs' });

async function classifyFile(filePath: string): Promise<string | null> {
  // Use the boundaries plugin's internal classification function.
  // If the plugin exposes it via getFileElement(), use that directly.
  // Otherwise, run the linter and check which element-types rule fires.
  const config = await linter.calculateConfigForFile(filePath);
  const boundariesSettings = config.settings?.['boundaries/elements'] ?? [];
  // Match each pattern in order; return the first hit
  for (const element of boundariesSettings) {
    const patterns = Array.isArray(element.pattern) ? element.pattern : [element.pattern];
    for (const p of patterns) {
      // Use minimatch or picomatch to test the pattern
      if (minimatch(filePath, p)) return element.type;
    }
  }
  return null;
}

describe('boundaries classification', () => {
  const cases: Array<[string, string]> = [
    ['src/entrypoints/cli.ts', 'entrypoints'],
    ['src/cli/print.ts', 'cli'],
    ['src/commands/launch.ts', 'commands'],
    ['src/ui/screens/AuthScreen.tsx', 'ui'],
    ['src/mcp/tools/memory.ts', 'mcp'],

    // Service classifications — the critical part
    ['src/services/auth/facade.ts', 'service-facade'],
    ['src/services/auth/facade/helper.ts', 'service-facade'], // facade-as-folder bypass closed
    ['src/services/auth/index.ts', 'service-index'],
    ['src/services/auth/client.ts', 'service-internal'],
    ['src/services/auth/device-code.ts', 'service-internal'],
    ['src/services/auth/nested/deep/helper.ts', 'service-internal'], // nested files caught
    ['src/services/auth/auth.test.ts', 'service-test'],
    ['src/services/auth/nested/deep.test.ts', 'service-test'], // nested tests caught

    // Pure layers
    ['src/utils/levenshtein.ts', 'utils'],
    ['src/types/api.ts', 'types'],
    ['src/constants/paths.ts', 'constants'],
    ['src/locales/en.ts', 'locales'],
    ['src/templates/solo.ts', 'templates'],
    ['src/migrations/0001-v1-config.ts', 'migrations'],
  ];

  for (const [path, expected] of cases) {
    it(`${path} classifies as ${expected}`, async () => {
      const actual = await classifyFile(path);
      expect(actual).toBe(expected);
    });
  }
});
```

This test runs in CI and fails if the boundaries plugin misclassifies any file. If a future version of `eslint-plugin-boundaries` changes pattern resolution, this test catches it before the real rules silently break.

### 10.2 Boundary leak scanner (AST-based)

Regex scanning has too many false positives (`device_token` as a legitimate field name) and false negatives (schemas not named with `Output` or `Result`). The leak scanner uses `ts-morph` to walk each facade's AST and extract actual Zod schema output types:

```ts
// tests/unit/facade-boundary-scan.test.ts

import { describe, it, expect } from 'vitest';
import { Project, Type, VariableDeclaration } from 'ts-morph';
import { globSync } from 'glob';

// Keys we never want to expose through an output schema. Whole-key match, not substring —
// so "device_token" (legitimate device identifier) doesn't collide with "token" (auth secret).
const FORBIDDEN_OUTPUT_KEYS = new Set([
  // Auth
  'token', 'access_token', 'refresh_token', 'api_key', 'apiKey', 'secret',
  'password', 'session_token', 'sessionToken',
  // Low-level handles
  'connection', 'db', 'pool', 'client', 'socket', 'stream',
  // Internal URLs
  'broker_url', 'api_url', 'internal_url', 'webhook_secret',
]);

// Patterns that indicate a raw filesystem path or secret-looking value
const FORBIDDEN_VALUE_PATTERNS = [
  /^\/home\//,
  /^\/Users\//,
  /^\/var\//,
  /^\/etc\//,
  /^~\//,
  /cm_(session|pat)_/,
];

describe('facade boundary scan (AST-based)', () => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
  });

  const facadeSourceFiles = project
    .getSourceFiles()
    .filter(f => f.getFilePath().includes('/services/') && f.getBaseName().startsWith('facade'));

  for (const sourceFile of facadeSourceFiles) {
    const filePath = sourceFile.getFilePath();

    it(`${filePath} — no forbidden keys in exported types`, () => {
      // Walk all exported type declarations and check their shape
      const exportedTypes = sourceFile.getExportedDeclarations();
      for (const [exportName, declarations] of exportedTypes) {
        for (const decl of declarations) {
          // Get the TypeScript type for this declaration
          const type = decl.getType();
          assertNoForbiddenKeysInType(type, exportName, filePath);
        }
      }
    });

    it(`${filePath} — no export * statements`, () => {
      const hasExportStar = sourceFile
        .getExportDeclarations()
        .some(d => d.isNamespaceExport());
      expect(hasExportStar, `${filePath} uses export * — use named exports`).toBe(false);
    });

    it(`${filePath} — does not import from ui/, commands/, cli/, mcp/, entrypoints/`, () => {
      const imports = sourceFile.getImportDeclarations();
      for (const imp of imports) {
        const spec = imp.getModuleSpecifierValue();
        expect(
          spec,
          `${filePath} imports from forbidden layer: ${spec}`,
        ).not.toMatch(/^(?:\.\.?\/)*(?:ui|commands|cli|mcp|entrypoints)\//);
      }
    });
  }
});

function assertNoForbiddenKeysInType(type: Type, contextName: string, file: string): void {
  // Check object property names
  if (type.isObject()) {
    for (const prop of type.getProperties()) {
      const name = prop.getName();
      // Exact match (not substring) so `device_token` doesn't collide with `token`
      if (FORBIDDEN_OUTPUT_KEYS.has(name)) {
        throw new Error(
          `Forbidden key "${name}" in exported type "${contextName}" at ${file}. ` +
          `Output types cannot expose raw tokens, secrets, or low-level handles.`,
        );
      }
      // Recurse into nested object types
      const propType = prop.getTypeAtLocation(prop.getValueDeclarationOrThrow());
      assertNoForbiddenKeysInType(propType, `${contextName}.${name}`, file);
    }
  }

  // Check union members (e.g. `A | B`)
  if (type.isUnion()) {
    for (const member of type.getUnionTypes()) {
      assertNoForbiddenKeysInType(member, contextName, file);
    }
  }

  // Check array element types
  if (type.isArray()) {
    const elementType = type.getArrayElementType();
    if (elementType) {
      assertNoForbiddenKeysInType(elementType, `${contextName}[]`, file);
    }
  }
}
```

This test:
- **Walks actual TypeScript types** using `ts-morph`, not regex on source strings
- **Exact key matches** on the forbidden list, so `device_token` (legitimate) doesn't trip on `token` (secret)
- **Recursive** — catches nested objects, arrays, and union types
- **Covers every exported type** including ones not named `Output` or `Result`
- **Runs on every CI build** — adding a facade automatically adds test coverage

The test is slower than regex scanning (parses the TS project), but it runs once per CI build (~5 seconds for the whole service tree) and its false-positive rate is zero.

### 10.3 UI tests use mock facades

UI components test against a mock facade, never the real service:

```ts
// ui/screens/AuthScreen.test.tsx

import { describe, it, expect, vi } from 'vitest';
import { render } from '@/tests/helpers/ink-render';
import { AuthScreen } from './AuthScreen';

vi.mock('@/services/auth/facade', () => ({
  loginWithDeviceCode: vi.fn().mockResolvedValue({
    user: { id: 'u1', display_name: 'Test User', email: 't@e.st' },
  }),
  whoAmI: vi.fn().mockResolvedValue({
    signed_in: false, user: null, token_source: null,
  }),
}));

it('AuthScreen renders signed-in state after login', async () => {
  const { lastFrame, stdin } = render(<AuthScreen />);
  stdin.write('\r');
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('Signed in as Test User');
});
```

The UI test never touches SQLite, never makes a network call, never reads an environment variable. It's a pure render test. If the UI ever accidentally imports from `services/auth/device-code` directly, ESLint catches it at CI before the test runs.

## 11. What facades never expose

Explicit blocklist. Any facade output containing one of these fails the boundary scanner:

1. **Raw auth tokens** — including session tokens, PATs, API keys, refresh tokens
2. **Full API URLs** — callers learn the endpoint through the service, not as data
3. **Database handles, prepared statements, transaction objects**
4. **Filesystem paths** as strings — if UI needs to show a path to the user, the service returns a `{ user_visible_path: '~/.claudemesh/...' }` where the field name explicitly says "for display"
5. **HTTP response objects** — headers, status codes, raw bodies
6. **Function references to other services** — the facade composes internally; callers get data only
7. **Opaque handles** that require follow-up facade calls to make useful — prefer self-contained returns
8. **Error stack traces** — facades throw domain errors; stack traces go to logs via `runtime/logger.ts`

## 12. Async streams and cancellation

For operations that stream data (log tails, message streams, sync progress), facades use async iterators with explicit `AbortSignal`:

```ts
// services/stream/facade.ts

import { z } from 'zod';
import { getStreamService } from './index';

const StreamEventSchema = z.object({
  type: z.enum(['message', 'peer_update', 'sync_progress']),
  timestamp: z.number().int(),
  payload: z.record(z.unknown()),
}).strict();

export type StreamEvent = z.infer<typeof StreamEventSchema>;

export async function* subscribeToMesh(input: {
  mesh_slug: string;
  signal: AbortSignal;
}): AsyncIterable<StreamEvent> {
  const service = getStreamService();
  const stream = service.subscribe(input.mesh_slug);

  try {
    input.signal.addEventListener('abort', () => stream.close(), { once: true });
    for await (const raw of stream) {
      if (input.signal.aborted) return;
      yield StreamEventSchema.parse({
        type: raw.type,
        timestamp: raw.timestamp,
        payload: raw.payload,
      });
    }
  } finally {
    stream.close();
  }
}
```

**Cancellation rules**:

- Every async iterator facade takes an `AbortSignal` as a required input field
- The facade attaches an `abort` listener that closes the underlying stream
- The `finally` block ensures the stream closes on any exit path (early return, throw, iterator break)
- Consumers MUST pass a signal — there's no "listen forever" mode

Consumers use it like this:

```ts
// ui/screens/StreamScreen.tsx
const ctrl = new AbortController();
useEffect(() => {
  (async () => {
    for await (const event of subscribeToMesh({ mesh_slug, signal: ctrl.signal })) {
      setEvents(prev => [...prev, event]);
    }
  })();
  return () => ctrl.abort();
}, [mesh_slug]);
```

## 13. Errors and validation

### 13.1 Input validation

Every facade input is `unknown` in the public type signature and parsed with Zod at the boundary:

```ts
export async function doThing(input: unknown): Promise<Result> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidInputError('specific message', parsed.error);
  }
  // ... use parsed.data safely
}
```

Why `unknown` instead of a typed input? Because facade callers sometimes come from dynamic sources (JSON input, command args, user config). Typing the input as `unknown` forces the facade to validate — a typed input would let a caller bypass validation with a cast.

### 13.2 Output validation

Every facade output is built explicitly (no spread, no pass-through) and `.parse()`'d through the output schema with `.strict()`. Strict mode rejects extra fields, eliminating the "class instance with matching fields" bypass.

### 13.3 Error mapping

Every facade catches all errors and maps them through `toDomainError(err)`:

- Domain errors already in the error hierarchy → returned as-is
- `ZodError` → mapped to a domain `InvalidInputError` with a generic message (never the raw Zod error, which might contain internal details)
- Node errors (`ENOTFOUND`, `ECONNREFUSED`, etc.) → mapped to `NetworkError` or similar
- Everything else → mapped to a generic `InternalError` with the raw error stored in `cause` for logging

The caller can catch specific error classes:

```ts
try {
  await loginWithDeviceCode();
} catch (err) {
  if (err instanceof DeviceCodeTimeoutError) {
    // specific handling
  } else if (err instanceof AuthNetworkError) {
    // different handling
  } else {
    // unexpected — report to telemetry
  }
}
```

### 13.4 Logging

Facades never log. Services log via `runtime/logger.ts`. This keeps the facade output deterministic (same input → same output → same thrown error), which is what makes them testable.

## 14. FAQ

### Why facades instead of tighter file naming?

Naming conventions rot. A rule "UI can only import files named `public-*.ts`" works for a week, then someone creates `helper.ts` that's "obviously meant to be public" and imports it. Facades are enforced by ESLint + dependency-cruiser + a boundary scanner test — three layers of tooling, not social pressure.

### Doesn't this add boilerplate?

~40-60 lines per service for the facade + schemas + error mapping. In exchange: testable UI, refactorable services, zero accidental leaks, zero circular imports, explicit contract that survives personnel changes. Worth it at scale.

### What about cross-service composition?

Services compose through each other's `index.ts`, not through facades. E.g., `services/mesh/publish.ts` imports `getAuthService` from `services/auth/index.ts`. Services are peers; facades are for non-service consumers.

### What about the MCP server?

MCP tool handlers run inside the service trust domain. They have access to `service-index` (cross-service composition) and their own internals, but NOT other services' internals. This keeps MCP implementations well-structured without forcing every tool to go through a UI-style facade.

### What if a facade needs to return a stream?

Async iterator with required `AbortSignal` (see §12). No callbacks, no EventEmitters, no Node streams exposed.

### What if two facades need the same internal helper?

Move the helper to `utils/` (if pure) or to a shared service (if effectful). Facades never share implementation — only types.

### How do we version facades across CLI releases?

Facade function signatures are the public contract. Breaking changes require a major version bump. Additive changes (new optional params, new optional return fields) are safe in minor releases. The boundary scanner test doubles as a regression guard — a PR that removes a field from an output schema will cause any test asserting on that field to fail.

### How do we handle complex flows with progress?

Either:
- Async iterator yielding progress events (preferred for long-running operations)
- Split into `start*` and `poll*` facade pairs where the UI polls for state
- Callbacks for progress (only progress, not state) — discouraged but allowed with explicit `signal` support

### What if a service has two types of consumers with different needs?

One facade per service. If MCP needs more than UI, the facade exposes more — and UI just doesn't call those methods. The facade's surface area is the union of all consumer needs, not the intersection.

### Can facades import from each other?

No. A facade belongs to exactly one service and imports only its own internals + other services' `index.ts`. If facade A wants to call facade B, that's a sign the logic belongs in a service, not a facade. The facade is an adapter, not an orchestrator.

### What about tests of nested service folders?

The boundary config uses `src/services/*/**/*.test.ts` which catches any depth. Tests can import from their own service's internals freely, as specified in the `service-test` rule.

### What about facades for utilities?

No. Utilities in `utils/` are pure functions; they need no facade. The facade pattern exists to bound effectful services, not pure code.

---

**End of spec.**
