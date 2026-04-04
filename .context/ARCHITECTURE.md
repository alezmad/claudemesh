# TurboStarter Architecture Reference

> LLM context document. Token-optimized. Source of truth: code in `packages/` and `apps/`.

## Stack Summary

```
Apps:     web (Next.js 16, React 19) | mobile (Expo 54, React Native)
API:      Hono (packages/api) → /api/* routes
Auth:     Better Auth 1.4.6 (packages/auth)
DB:       PostgreSQL + Drizzle ORM + pgvector (packages/db)
Billing:  Stripe | LemonSqueezy | Polar (packages/billing)
AI:       Multi-provider via AI SDK (packages/ai)
UI:       shadcn/ui + Radix (packages/ui-web, packages/ui-mobile)
```

## Directory Map

```
apps/
  web/src/
    app/[locale]/          # Next.js App Router (i18n)
      (marketing)/         # Public: landing, blog, pricing
      auth/                # Login, register, password reset
      dashboard/
        (user)/            # Personal dashboard
        [organization]/    # Multi-tenant org routes
      admin/               # Super admin
    modules/               # Feature modules
    lib/api/               # API client (server.ts, client.tsx)
    config/                # paths.ts, app.ts
  mobile/src/
    app/                   # Expo Router
    modules/               # Feature modules

packages/
  api/src/
    index.ts               # Main router, exports AppRouter type
    modules/               # Feature routers (admin/, ai/, auth/, billing/, organizations/, storage/)
  auth/src/
    server.ts              # Better Auth config
    client.tsx             # Client helpers
  db/src/
    schema/                # Drizzle schemas (auth.ts, chat.ts, image.ts, pdf.ts, customer.ts, credit-transaction.ts)
    migrations/            # SQL migration files
  ai/src/modules/
    chat/                  # Multi-provider chat
    image/                 # Image generation
    pdf/                   # RAG pipeline
    tts/                   # Text-to-speech
    stt/                   # Speech-to-text
    credits/               # Usage metering
  billing/src/
    providers/             # stripe/, lemonsqueezy/, polar/
  i18n/translations/       # JSON translation files
  ui/web/src/              # 45+ shadcn components
  ui/mobile/src/           # React Native components
```

## Database Schema

### Tables by Schema

| Schema | Table | Key Columns | Purpose |
|--------|-------|-------------|---------|
| public | `user` | id, email, emailVerified, banned, role, isAnonymous | Users |
| public | `session` | id, userId, activeOrganizationId, impersonatedBy | Sessions |
| public | `account` | userId, providerId, accountId | OAuth accounts |
| public | `verification` | identifier, value, expiresAt | Email tokens |
| public | `passkey` | userId, publicKey, credentialId | WebAuthn |
| public | `two_factor` | userId, secret, backupCodes | 2FA |
| public | `organization` | id, name, slug | Orgs |
| public | `member` | userId, organizationId, role | Membership |
| public | `invitation` | email, organizationId, role, status | Invites |
| public | `customer` | userId, customerId, plan, credits | Billing |
| public | `credit_transaction` | customerId, type, amount, balance | Credit ledger |
| chat | `chat` | id, userId, title | Chat sessions |
| chat | `message` | chatId, role, content | Messages |
| chat | `part` | messageId, type, order, details | Message parts |
| image | `generation` | userId, prompt, model, aspectRatio | Image requests |
| image | `image` | generationId, url | Generated images |
| pdf | `document` | userId, name, status, s3Key | PDF files |
| pdf | `chat` | documentId, userId | PDF chats |
| pdf | `message` | chatId, role, content | PDF messages |
| pdf | `embedding` | documentId, chunkIndex, embedding(1536) | Vectors |
| pdf | `retrieval_chunk` | documentId, content, pageNumber | Semantic chunks |
| pdf | `citation_unit` | documentId, pageNumber, bbox, content | Citations |

### Enums

```typescript
// packages/db/src/schema/auth.ts
memberRole: 'owner' | 'admin' | 'member'
invitationStatus: 'pending' | 'accepted' | 'rejected' | 'canceled'

// packages/db/src/schema/customer.ts
billingPlan: 'free' | 'premium' | 'enterprise'

// packages/db/src/schema/credit-transaction.ts
creditTransactionType: 'signup' | 'purchase' | 'usage' | 'admin_grant' | 'admin_deduct' | 'refund' | 'promo' | 'referral' | 'expiry'

// packages/db/src/schema/chat.ts
messageRole: 'system' | 'assistant' | 'user'

// packages/db/src/schema/image.ts
aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

// packages/db/src/schema/pdf.ts
documentStatus: 'pending' | 'processing' | 'ready' | 'failed'
citationUnitType: 'prose' | 'heading' | 'list' | 'table' | 'code'
```

## API Pattern

### Router Structure

```typescript
// packages/api/src/index.ts
app.route("/admin", adminRouter)    // Admin operations
app.route("/ai", aiRouter)          // AI features
app.route("/auth", authRouter)      // Auth (Better Auth)
app.route("/billing", billingRouter)// Billing webhooks/checkout
app.route("/organizations", orgRouter)
app.route("/storage", storageRouter)
```

### Module Pattern

```
packages/api/src/modules/<feature>/
  router.ts      # Hono router
  queries.ts     # Read operations
  mutations.ts   # Write operations
```

### Type-Safe Client

```typescript
// Server component
import { api } from "~/lib/api/server";
const data = await api.admin.users.$get({ query: { page: "1" } });

// Client component
import { api } from "~/lib/api/client";
const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.admin.users.$get() });
```

## AI Providers

### Chat Models

| Provider | Models | Package |
|----------|--------|---------|
| OpenAI | gpt-5.1, gpt-4o, o3, o4-mini | @ai-sdk/openai |
| Anthropic | claude-4-sonnet, claude-3.7-sonnet | @ai-sdk/anthropic |
| Google | gemini-2.5-pro, gemini-2.5-flash | @ai-sdk/google |
| xAI | grok-4, grok-3-mini-fast | @ai-sdk/xai |
| DeepSeek | deepseek-v3, deepseek-r1 | @ai-sdk/deepseek |

### Image Models

| Provider | Models |
|----------|--------|
| OpenAI | gpt-image-1, dall-e-2, dall-e-3 |
| Replicate | recraft-v3, photon, stable-diffusion-3.5 |

### Other AI Services

| Service | Provider | Location |
|---------|----------|----------|
| TTS | ElevenLabs | packages/ai/src/modules/tts/ |
| STT | OpenAI Whisper | packages/ai/src/modules/stt/ |
| Embeddings | OpenAI | packages/ai/src/modules/pdf/ |
| Vector Search | pgvector + HNSW | packages/db/src/schema/pdf.ts |

## Auth Configuration

### Methods

```
Email/Password | Magic Link | OAuth (Google, GitHub, Apple) | Passkeys | 2FA/TOTP | Anonymous
```

### Session Fields

```typescript
session: {
  userId: string
  activeOrganizationId?: string  // Multi-tenant context
  impersonatedBy?: string        // Admin impersonation
}
```

### RBAC

```
Organization roles: owner > admin > member
User role field: 'user' | 'admin' (super admin)
```

## Billing Configuration

### Providers

```typescript
// packages/billing/src/providers/
stripe/         # Stripe subscriptions + one-time
lemonsqueezy/   # LemonSqueezy
polar/          # Polar
```

### Credit System

```typescript
// Deduct credits
await deductCredits(customerId, amount, 'usage', { feature: 'chat' });

// Check balance
const balance = await getCreditsBalance(customerId);

// Transaction types
'signup' | 'purchase' | 'usage' | 'admin_grant' | 'admin_deduct' | 'refund' | 'promo' | 'referral' | 'expiry'
```

## Commands

```bash
# Dev
pnpm install                    # Install deps
pnpm services:start             # Start PostgreSQL (Docker)
pnpm with-env -F @turbostarter/db db:setup  # Migrate + seed
pnpm dev                        # Start all apps
pnpm --filter web dev           # Web only
pnpm --filter mobile ios        # Mobile iOS

# Database
pnpm with-env -F @turbostarter/db db:generate  # Generate migration
pnpm with-env -F @turbostarter/db db:migrate   # Apply migrations
pnpm with-env -F @turbostarter/db db:push      # Push (dev only)
pnpm with-env -F @turbostarter/db db:studio    # GUI

# Quality
pnpm typecheck                  # Type check all
pnpm lint                       # ESLint
pnpm test                       # Vitest
pnpm build                      # Build all
```

## Critical Invariants

### Must Do

- Use `pnpm with-env` for all DB commands
- Go through API layer for data access
- Server-side auth/authz enforcement
- Use Drizzle ORM, never raw SQL (except migrations)
- Use existing UI components from packages/ui-*

### Must Not

- Access DB directly from apps
- Client-side auth checks as security
- Business logic in React components
- Skip migrations in production
- Introduce new state management libs

## File Patterns

### Add Dashboard Page

```
1. Define path: apps/web/src/config/paths.ts
2. Add sidebar item: apps/web/src/app/[locale]/dashboard/(user)/layout.tsx
3. Create page: apps/web/src/app/[locale]/dashboard/(user)/my-feature/page.tsx
4. Add translations: packages/i18n/translations/en/dashboard.json
```

### Add API Endpoint

```
1. Create module: packages/api/src/modules/<feature>/
2. Add router.ts, queries.ts, mutations.ts
3. Mount in packages/api/src/index.ts
4. Types auto-available via Hono RPC
```

### Add DB Table

```
1. Edit schema: packages/db/src/schema/<domain>.ts
2. Export from packages/db/src/schema/index.ts
3. Generate: pnpm with-env -F @turbostarter/db db:generate
4. Migrate: pnpm with-env -F @turbostarter/db db:migrate
```

## Package Exports

| Package | Export | Use |
|---------|--------|-----|
| @turbostarter/db | /server | Server-only DB access |
| @turbostarter/auth | /server, /client | Auth helpers |
| @turbostarter/api | /utils | handle(), response helpers |
| @turbostarter/i18n | /server, /client | Translation functions |
| @turbostarter/ui-web | /<component> | UI components |

## Environment Variables

### Required (turbo.json globalEnv)

```
DATABASE_URL      # PostgreSQL connection
PRODUCT_NAME      # App name
URL               # Base URL
DEFAULT_LOCALE    # Default language (en)
```

### Location

```
.env              # Root (DB, shared secrets)
apps/web/.env.local       # Web-specific
apps/mobile/.env.local    # Mobile-specific
```

## Not In This Codebase

- Browser extension (apps/extension) - available in TurboStarter Core separately
- WXT framework references
- Extension-specific docs in .context/turbostarter-framework-context/sections/extension/
