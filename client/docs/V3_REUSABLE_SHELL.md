# v3 Reusable Shell (#1498)

The v2 subscription product (subscription lists, renewal calendars, reminder
settings, gift-card flows, cancel links) has been torn down. This file records
what survives as the reusable shell for v3 and what was removed.

## Keep — reusable shell

| Area | Location | Notes |
| --- | --- | --- |
| Auth | `lib/supabase/{client,server,server-client,browser-client,middleware}.ts`, `middleware.ts`, `hooks/use-auth.ts`, `hooks/use-mfa.ts`, `lib/api/mfa.ts`, `app/auth/`, `components/mfa/` | Session handling, route protection, 2FA. |
| Layout | `app/layout.tsx`, `app/error.tsx`, `app/loading.tsx`, `app/not-found.tsx`, `components/layout/app-layout.tsx` | Root layout, error/loading boundaries, app frame. Subscription props (bulk actions, budget alert, add-subscription) removed. |
| Navigation | `components/layout/{sidebar,header,mobile-menu-button}.tsx`, `components/command-palette.tsx`, `lib/keyboard-shortcuts.ts` | Subscription, analytics and integrations entries removed. `app-layout` is not mounted by any route yet; v3 views plug in via `activeView`. |
| Design primitives | `packages/ui` (`@syncro/ui`): button, card, input, label, select, switch, badge, alert, toast, skeleton, progress, empty-state, data-states, error-boundary, confirmation-dialog, aria-live-announcer, command | Product-agnostic. |
| Tables | `@syncro/ui`: `data-table`, `virtualized-list`, `paginated-virtualized-list`, `advanced-filter-bar` | |
| Charts | `@syncro/ui`: `sparkline`, `delta-indicator`, `numeric-display`; `components/spend-chart.tsx` | `spend-chart` takes plain `{ month, category, amount }` rows. |
| Providers | `components/providers/{query,nonce,user-settings}-provider.tsx`, `components/theme-provider.tsx`, `components/pwa-provider.tsx` | |
| Hooks | `use-toast`, `use-confirmation-dialog`, `use-debounce`, `use-modal-manager`, `use-exchange-rates`, `use-wallet`, `use-pwa-install`, `use-undo-manager`, `use-api` | |
| Widgets | `components/widgets/{blockchain-badge,offline-indicator,pwa-install-banner,gas-estimate}.tsx` | |
| Utilities | `lib/{logger,telemetry,security,security-utils,currency-utils,exchange-rates,timezone-utils,accessibility-utils,feature-flags,query-config,network-utils,csv-utils}.ts`, `lib/api/*` (except the removed clients below) | |

## Routes after teardown

| Route | State |
| --- | --- |
| `/` | Redirects to `/dashboard`. |
| `/dashboard`, `/dashboard/overview` | v3 principal overview (kept). |
| `/settings/*` | Kept. Reminder settings removed from `/settings/notifications`; gift-card provider picker and reminder timing jitter removed from `/settings/privacy`. |
| `/offline` | Generic offline fallback; no cached subscription list. |
| `/email-preferences` | Kept: it is the unsubscribe target linked from already-sent emails (see `backend/src/routes/compliance.ts`). |
| `/dashboard/analytics`, `/dashboard/subscriptions/[id]`, `/spend-chart-demo` | Removed. |

## Removed

- **Pages:** the subscription SPA behind `/` (`components/app/*`, `components/pages/*`, `app/page-data.ts`), `/dashboard/analytics`, `/dashboard/subscriptions/[id]`, `/spend-chart-demo`.
- **API routes:** `app/api/subscriptions/**`, `app/api/v2/subscriptions`, `app/api/tags/**`, `app/api/analytics`, `app/api/sync/offline`.
- **Components:** subscription modals (add/edit/manage/renew, CSV import, insights, onboarding, upgrade plan, email account, integrations, notification preferences), cancellation-guide modal, subscription list and priority UI, notifications panel, onboarding tours, undo panel/context, budget alert, bulk actions bar, reminder settings, tag input, push notification toggle, subscription event feed, payment timeline, duplicate review, forecast chart.
- **Hooks:** `use-subscriptions`, `use-subscription-*`, `use-bulk-actions`, `use-email-accounts`, `use-notifications`, `use-notification-actions`, `use-push-notifications`, `use-reminder-listener`, `use-tags`, `use-mutation-queue`, `use-offline-queue`.
- **Data fetching:** `lib/api/{analytics,email-accounts,reminder-settings,renewal-history}.ts`, `lib/supabase/{subscriptions,tags,cancellation-guides,notification-preferences}.ts`, `lib/subscription-*.ts`, `lib/dashboard-*.ts`, `lib/sync/*`, `lib/offline-cache.ts`, `lib/indexed-db.ts`, `lib/gift-card-providers/*`, `lib/atomic-wallet.ts`, `lib/reminder-listener.ts`, `public/reminder-sw.js`. Any leftover import now fails the build.
- **Service worker:** `public/sw.js` no longer caches `/api/subscriptions`, replays subscription mutations, or shows renewal push notifications. Its cache name was bumped so old subscription caches are purged.
- **Tests, stories, e2e specs** for all of the above.

## Deprecation banner

The sunset deprecation banner stays in place until its date passes. Do not
remove it as part of this teardown.
