# Dependency Privacy Audit

Date: 2026-06-27
Scope: client, backend, shared, and SDK dependencies used by SYNCRO.

## Summary

This audit reviewed the repository's dependency graph, telemetry-related integrations, and external service calls that could disclose user or usage data to third parties. The primary findings are:

- Next.js telemetry is now disabled by default for local dev/build/start workflows.
- Sentry is configured for error monitoring, but the shared scrubber redacts common PII and auth material before events are sent.
- Supabase is used as the primary persistence layer; the client uses the public anon key and the backend uses the service role key in server-side contexts.
- The Stellar SDK itself does not appear to include a built-in telemetry/phone-home feature in the current usage pattern, but the application does contact Stellar RPC endpoints and Horizon endpoints as part of blockchain operations.
- The Vercel Analytics dependency has been removed from the client package manifest unless product requirements explicitly need it again.

## High-level findings

### 1. Next.js

- Runtime/build telemetry is disabled by default through the client package scripts and the Next.js config environment override.
- Recommended setting: keep `NEXT_TELEMETRY_DISABLED=1` in local development, CI, and production build environments.

### 2. Sentry

- Sentry is enabled in the client and backend for crash/error reporting.
- The shared scrubber in [shared/src/sentry.ts](../../shared/src/sentry.ts) redacts headers, cookies, auth tokens, secrets, and common card/payment fields before events are sent.
- Privacy note: Sentry still receives error context and stack traces; this is acceptable for operational monitoring but should remain opt-in via environment configuration rather than being forced on in all environments.
- Disable/limit in non-production if the team wants stricter privacy posture.

### 3. Supabase

- The client uses Supabase via the public anon key for browser-side operations.
- The backend uses the service role key for server-side operations.
- Supabase is a first-party data dependency for the app, but it has its own server-side processing of requests. The app should avoid sending unnecessary user metadata or PII beyond what the database schema requires.
- Recommended guardrails:
  - Keep auth and RLS policies strict.
  - Avoid logging raw request bodies and query results.
  - Prefer server-side aggregation and only return necessary fields to the client.

### 4. Stellar SDK

- The backend imports `@stellar/stellar-sdk` and uses it to interact with Stellar RPC/Horizon endpoints.
- No evidence of explicit telemetry/phone-home behavior was found in the repository's usage of the SDK.
- Privacy note: network traffic to Stellar infrastructure is expected and necessary for wallet and blockchain features; this should be treated as a data boundary and not as analytics telemetry.

### 5. Vercel Analytics

- The client package no longer depends on `@vercel/analytics`.
- This dependency can send page-view and performance data to Vercel if enabled by the application layer, so removing it eliminates an unnecessary third-party analytics path.
- Recommendation: keep it removed unless the product explicitly needs it again and the consent banner and privacy policy are updated accordingly.

## Dependency inventory and privacy posture

| Dependency | Category | Privacy concern | Status | Disable / reduce guidance |
| --- | --- | --- | --- | --- |
| next | Framework | Telemetry | Disabled by default | Keep `NEXT_TELEMETRY_DISABLED=1` |
| @sentry/nextjs | Error monitoring | Sends error context to Sentry | Enabled with scrubbing | Keep DSN optional; scrub PII; disable in local-only or privacy-first envs |
| @sentry/node | Error monitoring | Sends error context to Sentry | Enabled with scrubbing | Same as above |
| @supabase/supabase-js | Backend/database | Sends data to Supabase services | Required | Limit payloads; don’t log secrets; keep RLS strict |
| @supabase/ssr | Browser/server auth | Uses Supabase auth endpoints | Required | Use anon key client-side only; keep service role server-side only |
| @stellar/stellar-sdk | Blockchain | Network requests to Stellar infrastructure | Required | Treat as required network traffic; keep RPC endpoints configurable |
| @vercel/analytics | Analytics | Third-party analytics collection | Recommended removal | Remove dependency unless a documented product need exists |

## External service calls in the current codebase

### Required / expected network dependencies

- Stellar RPC endpoints such as `soroban-rpc.creit.tech`, `rpc-futurenet.stellar.org`, and `soroban-testnet.stellar.org`.
- Supabase API endpoints via the configured Supabase project URL.
- Google/Microsoft/Telegram/Paystack integrations where the product explicitly uses those providers.
- Sentry endpoints when error reporting is enabled.

### Potentially unnecessary / review-worthy integrations

- Vercel Analytics dependency in the client package manifest.
- Any future browser-side analytics SDKs should be gated behind explicit user consent and not enabled by default.

## Recommendations

1. Remove `@vercel/analytics` unless there is a clear product requirement for it.
2. Keep Sentry enabled only where crash monitoring is necessary, and continue using the scrubbing layer.
3. Preserve the `NEXT_TELEMETRY_DISABLED=1` setting across dev, CI, and production build scripts.
4. Review any future dependency that includes telemetry or analytics features before adding it.
5. Add a lightweight dependency review checklist to the contribution process so new packages are screened for telemetry/phone-home behavior.

## Notes for future reviews

- No new dependencies should be added without a privacy review.
- Any dependency that claims analytics, telemetry, or usage reporting should be treated as a privacy risk until proven otherwise.
