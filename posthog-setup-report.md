<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the claudemesh `apps/web` Next.js app. The project already had PostHog initialized via the `@turbostarter/analytics-web` package (which wraps `posthog-js` and `posthog-node`), user identification in `AnalyticsProvider`, and environment variable support. This integration adds 11 targeted `track()` calls across 10 files covering every critical business action: auth flows, organization lifecycle, team growth, and billing conversion.

Environment variables `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` were updated in `apps/web/.env.local`.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | Fired when a user successfully completes email registration | `apps/web/src/modules/auth/form/register-form.tsx` |
| `user_logged_in` | Fired when a user successfully signs in with password | `apps/web/src/modules/auth/form/login/password.tsx` |
| `magic_link_requested` | Fired when a user requests a magic link login email | `apps/web/src/modules/auth/form/login/magic-link.tsx` |
| `social_login_initiated` | Fired when a user clicks a social provider login button | `apps/web/src/modules/auth/form/social-providers.tsx` |
| `anonymous_login_completed` | Fired when a user successfully signs in anonymously | `apps/web/src/modules/auth/form/anonymous.tsx` |
| `organization_created` | Fired when a user successfully creates a new organization | `apps/web/src/modules/organization/create-organization.tsx` |
| `organization_deleted` | Fired when an organization owner deletes their organization | `apps/web/src/modules/organization/settings/delete-organization.tsx` |
| `organization_left` | Fired when a user leaves an organization | `apps/web/src/modules/organization/settings/leave-organization.tsx` |
| `member_invited` | Fired when one or more members are successfully invited to an organization | `apps/web/src/modules/organization/members/invite-member.tsx` |
| `checkout_initiated` | Fired when a user clicks to start a subscription checkout | `apps/web/src/modules/billing/pricing/plans/plan/hooks/use-plan.tsx` |
| `billing_portal_opened` | Fired when an existing subscriber opens the billing management portal | `apps/web/src/modules/billing/pricing/plans/plan/hooks/use-plan.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/38842/dashboard/612816
- **Signup → Org → Checkout Funnel**: https://eu.posthog.com/project/38842/insights/RmpquGPI
- **Daily Signups & Logins**: https://eu.posthog.com/project/38842/insights/uWbM5XYu
- **Checkout Intent Over Time**: https://eu.posthog.com/project/38842/insights/daNayl8L
- **Viral Growth: Member Invitations**: https://eu.posthog.com/project/38842/insights/z3OMt63C
- **Churn Signals: Orgs Deleted & Left**: https://eu.posthog.com/project/38842/insights/zP4icTo1

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
