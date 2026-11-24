# SYNCRO Telemetry Policy

> **Effective Date:** June 2026

SYNCRO is committed to user privacy. This document describes what data our platform collects, how it is handled, and the choices available to users.

---

## What We Collect

| Category | Data | Collected |
|---|---|---|
| Error tracking | Anonymised stack traces, component names | Yes (via Sentry) |
| Usage metrics | Page views, feature interactions | Yes (Vercel Analytics — aggregate only) |
| Subscription data | Names, prices, billing cycles | Stored in your account only |
| On-chain audit logs | Subscription event hashes / encrypted blobs | Yes, when blockchain sync is enabled |
| Crash reports | Device type, OS, browser | Yes (via Sentry) |
| Personal messages / email body | Email content | **Never** |

---

## Privacy Mode

When **Privacy Mode** is enabled in Settings → Privacy & Data:

- All Sentry error and warning telemetry is **completely suppressed**.
- Server-side logs are **fully redacted** — user IDs and metadata appear as `[REDACTED_PRIVACY_MODE]`.
- No data is sent to any third-party analytics service.
- Aggregate metrics (e.g. budget trends) use **differential privacy (Laplace noise)** so individual values cannot be reverse-engineered.

---

## On-Chain Logging

SYNCRO uses a Soroban smart contract on the Stellar network to create an immutable audit trail of subscription lifecycle events.

- **Standard mode:** Event metadata (name, price, status, timestamp) is written in plaintext.
- **PRIVACY_ENCRYPT_ON_CHAIN enabled:** Metadata is AES-256-GCM encrypted with a key derived from your user ID before being written to the contract. The contract only ever sees the ciphertext.
- **PRIVACY_AUDIT_COMMITMENTS enabled:** Events are stored as Pedersen commitments — no underlying data is visible on-chain, even to SYNCRO.
- Timestamps are **coarsened to day-level** (midnight UTC) to prevent timing correlation attacks.

---

## Third-Party Services

| Service | Purpose | Data Shared |
|---|---|---|
| Sentry | Error monitoring | Stack traces, device info (no PII in privacy mode) |
| Vercel Analytics | Page analytics | Aggregate page view counts only |
| Stellar / Soroban | Blockchain audit logs | Encrypted blobs or commitments only |
| Supabase | Database | Your account data (encrypted at rest) |

SYNCRO does **not** sell or share your data with any third parties for marketing purposes.

---

## Differential Privacy for Aggregate Metrics

Budget summaries, category spend breakdowns, and forecast data shown in your dashboard are computed server-side. When Privacy Mode is active, **Laplace noise** is added to numeric metrics before they leave the server, ensuring that individual subscription values cannot be inferred from aggregate outputs.

---

## Your Rights

Under GDPR and similar regulations you have the right to:

- **Export** your data (Settings → Privacy & Data → Download Export).
- **Delete** your account and all associated data (Settings → Privacy & Data → Delete Account).
- **Opt out** of all non-essential telemetry by enabling Privacy Mode.

For privacy enquiries contact: **privacy@syncro.app**

---

## Changes to This Policy

We will notify users of material changes to this policy via email and in-app notice at least 30 days in advance.
