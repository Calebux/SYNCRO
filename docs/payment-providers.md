# Payment Provider Matrix

## Overview

SYNCRO supports multiple payment providers. Which provider is shown to a user
depends on their region and the current environment. The logic lives in
`client/lib/payment-providers.ts` and is enforced at the API layer.

## Provider Matrix

| Provider | Regions          | Currency | Environments               |
|----------|-----------------|----------|----------------------------|
| Paystack | NG, GH, ZA, KE  | NGN      | production, development, test |
| PayPal   | INTL            | USD      | production, development, test |
| Mock     | All             | USD      | development, test only     |

> **Rule:** Paystack and PayPal regions never overlap. A user is shown exactly
> one real provider based on their region. Never show both to the same user.

## Region Codes

| Code | Market                  |
|------|------------------------|
| NG   | Nigeria                |
| GH   | Ghana                  |
| ZA   | South Africa           |
| KE   | Kenya                  |
| INTL | All other countries    |

## Unsupported Combinations

These combinations are explicitly blocked:

- **PayPal + African regions (NG/GH/ZA/KE):** Paystack is the correct provider
  for these markets. PayPal is not surfaced.
- **Paystack + INTL:** Paystack does not operate outside its supported regions.
- **Mock + production:** Mock payments are disabled in production regardless of
  environment variables.

## Required Environment Variables

```env
# Paystack — required for African market users
PAYSTACK_SECRET_KEY=sk_live_...

# PayPal — required for international users
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_MODE=live          # "sandbox" for development

# Stripe — optional, international fallback
STRIPE_SECRET_KEY=sk_live_...

# Development only
ENABLE_MOCK_PAYMENTS=true # only respected when NODE_ENV=development
```

## Architecture