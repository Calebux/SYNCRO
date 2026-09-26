# @syncro/shared

## 1.0.1

### Patch Changes

- f9d9809: v3 major release: subscription APIs removed, clean break from previous major.
  The `@syncro/sdk` package now ships the v3 payments surface only.
  Subscription CRUD, analytics, notification, and gift-card APIs have been removed.
  The `@syncro/sdk/v3` sub-path provides the x402 payments API (GatewayClient,
  createPaidFetch, receipt verification, retry, gateway errors).
  See `sdk/README.md` for the v3 quickstart and migration notes.
