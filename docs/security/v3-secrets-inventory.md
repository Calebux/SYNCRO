# v3 Secrets Inventory and Rotation Record

**Status:** Source inventory completed 2026-09-25  
**Scope:** repository, local environment contracts, GitHub Actions references, and deployed application code paths  
**Owner:** Security / platform team

This is a name-only inventory. Secret values must never be added here. Provider-side revocation requires access to the named provider account and is recorded as an action below; removing a variable from Git or CI is not revocation.

## Classification

### Still needed

| Secret or credential | Runtime consumer | Minimum scope | Storage and rotation action |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Backend database/admin jobs and migration scripts | Server-side only; never client or browser | Separate per environment; rotate in Supabase and every deployment/CI store |
| `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client SDK with RLS | Public anon role only; RLS is the control | Per-environment values; no service-role permissions |
| `JWT_SECRET` | Backend session/token signing | Signing only; separate per environment | Rotate with forced re-authentication |
| `ADMIN_API_KEY` | Backend admin middleware | Admin endpoints only; do not share with CI smoke users | Separate per environment; rotate on a 90-day schedule |
| `ENCRYPTION_KEY` and `COMMITMENT_ENCRYPTION_KEY` | Application data encryption | Encryption/decryption only; no network/provider permissions | Store in the backend secret manager; use a planned re-encryption rotation |
| `CHANNEL_SIGNING_SECRET` | v3 payment-channel state signing | v3 channel signatures only | Separate per environment; remove development fallback before production |
| `STELLAR_SECRET_KEY`, `AGENT_MASTER_SEED` | Stellar transaction signing and agent wallet derivation | Dedicated low-balance operational accounts; no unrelated provider access | Use separate deployer/agent identities and rotate per wallet policy |
| `SECRET_PROVIDER_TYPE`, `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_MOUNT` | Secret-provider infrastructure | Read only the named secret paths; no broad Vault token | Prefer workload identity or a path-scoped token |

### Needed with reduced scope

| Secret or credential | Why retained | Required reduction |
|---|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | v3 Telegram notification transport | Bot must be limited to the v3 notification bot; webhook secret only validates the configured endpoint |
| `SLACK_WEBHOOK_URL` and stored team Slack webhooks | v3 operator notifications | Use a dedicated channel webhook with posting-only permission; do not use a workspace-wide token |
| `VAPID_PRIVATE_KEY` | v3 push notifications | Push-signing key only; public key may be exposed to the client |
| `SENTRY_AUTH_TOKEN` | Release/source-map and monitoring automation | Restrict to the project and release operations; do not inject into runtime client builds |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Optional backend classification fallback | Provider project/key restricted to the required model APIs, with spend limits; absent unless the feature is enabled |
| Google/Microsoft OAuth client secrets | Legacy mail integrations still present in source | **Temporary legacy hold:** revoke after the integration routes and stored grants are retired; do not provision new values for v3 |

### Revoke at provider and remove from configuration

| Secret or credential | Evidence in repository | Provider action required |
|---|---|---|
| `SMTP_USER`, `SMTP_PASS` and any SMTP credential pair | Previously required by backend env contract; v3 email delivery is now disabled and SMTP values are no longer read | Disable/delete the SMTP credential at the mail provider; remove GitHub/environment-manager entries |
| `STRIPE_SECRET_KEY`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_LIVE_SECRET_KEY` | Legacy client payment service and webhook code | Revoke all test and live restricted/secret keys in Stripe; remove CI and deployment entries |
| `STRIPE_WEBHOOK_SECRET` | Legacy Stripe webhook verification | Delete/rotate the Stripe webhook endpoint secret after the endpoint is retired |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | Legacy PayPal service and webhook verification | Delete the PayPal app credentials and webhook in both sandbox and live accounts |
| `PAYSTACK_SECRET_KEY` | Legacy Paystack service and webhook verification | Revoke the test and live keys in Paystack |
| Gift-card provider API keys | No API-key variables or provider SDK credentials found; providers are public purchase URLs (`atomicwallet.io`, Bitrefill onion URL, Coincards URL) | Confirm provider dashboards contain no Syncro API keys or merchant credentials; revoke any out-of-band credentials and record the provider ticket/account ID |

## Environment and CI coverage

The checked-in environment contracts are `backend/src/config/env.ts`, `backend/scripts/env.manifest.js`, `backend/.env.example`, `client/lib/api/env.ts`, `client/scripts/env.manifest.js`, and `client/.env.example`. CI references are under `.github/workflows/` and `backend/src/dependency-vulnerability-scanning/ci.yml`.

The v3 application uses `backend/src/routes/v3/` and `backend/src/services/v3/`; it does not require SMTP, gift-card-provider credentials, or payment-processor credentials. The v3 notification defaults and dispatcher no longer select or retrieve email credentials.

## Required provider-side closeout

This repository cannot authenticate to Stripe, PayPal, Paystack, SMTP, Google, Microsoft, or gift-card provider dashboards. The inventory is therefore not complete until an authorized operator records, for each revoked item above:

1. Provider and environment (test/staging/production).
2. Credential or webhook identifier suffix, never the secret value.
3. Revocation timestamp and operator/ticket.
4. A deployment check showing the old value is absent from runtime and CI environments.

Until those records exist, the payment and legacy mail rows remain **pending provider revocation**, not complete.