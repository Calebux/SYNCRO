# Shared Business Logic

Issue #602 moved repeated pure business rules into `@syncro/shared`.

Use `shared/` for logic that has no database client, browser API, Express request, Next.js request, secret, or queue dependency. Good candidates include billing-cycle math, category totals, renewal windows, URL safety checks, and display masking rules.

Keep layer-specific work in its owner:

- Next.js routes handle user-scoped requests with Supabase SSR auth and RLS.
- The Express backend handles jobs, admin paths, service-role work, queues, and integrations.
- UI-only helpers stay in `client/lib`.

Current shared helpers:

- `normalizeToMonthlyAmount`, `calculateMonthlySpend`, `buildCategoryMonthlySpend`, `getTopMonthlySpendSubscriptions`, `countUpcomingRenewals`, and `buildPastMonthlySpendTrend` in `shared/src/subscription-math.ts`.
- `isSafeHttpUrl`, `sanitizeUrl`, `validateEmail`, `maskEmail`, and `maskApiKey` in `shared/src/security.ts`.

When adding a new helper, keep it deterministic and pass all inputs as plain values. If the function needs Supabase, Redis, `window`, `crypto.getRandomValues`, logging, or request headers, put the side effect in the client or backend and call a smaller shared function from there.
