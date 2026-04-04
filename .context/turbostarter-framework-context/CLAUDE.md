# TurboStarter Framework Context

TurboStarter framework documentation for AI context loading.

## When to Read More

**Read `index.md`** if you need to:
- Find TurboStarter documentation on a specific topic
- Search by keyword (auth, database, billing, api, etc.)
- Understand what documentation is available

**Read `framework.md`** for:
- pnpm commands and workflows
- Monorepo structure
- Code conventions

## Quick Reference

| Need | Read |
|------|------|
| Commands & patterns | `framework.md` |
| Authentication | `sections/web/auth/` |
| Database/Drizzle | `sections/web/database/` |
| API/Hono | `sections/web/api/` |
| Billing/Stripe | `sections/web/billing/` |
| UI Components | `sections/web/ui/` |
| Organizations | `sections/web/organizations/` |
| i18n | `sections/web/i18n/` |
| Mobile | `sections/mobile/` |

## Refreshing

```bash
python .context/turbostarter-framework-context/refresh-docs.py
```

## Notes

- These docs are **subordinate** to `.context/CLAUDE.md`
- Adapt patterns to match existing codebase, don't copy verbatim
- When in doubt, check the actual code in `packages/` and `apps/`
