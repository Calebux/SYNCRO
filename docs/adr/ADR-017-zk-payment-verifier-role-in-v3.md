# ADR-017: Role of zk-payment-verifier in v3

**Status:** Proposed
**Date:** 2026-09-28
**Deciders:** Contracts and Backend teams
**Issue:** [#1437](https://github.com/Calebux/SYNCRO/issues/1437)
**Related ADRs:** [ADR-005](./ADR-005-payment-channels-for-renewals.md), [ADR-016](./ADR-016-upgrade-policy-for-settlement-contracts.md)

---

## Context

`zk-payment-verifier` (412 LOC) and `shared` stealth helpers are a privacy
layer built for the subscription product. The v3 pivot to metered agent
payment rails over payment channels changes what privacy is even achievable,
so the verifier must not survive into v3 unexamined.

### What privacy does v3 want?

| Property | Achievable under the channel model? |
| :--- | :--- |
| Hiding which provider an agent pays | No — channel open and settlement name the counterparty on-chain. |
| Hiding amounts | No — `balance_a` / `balance_b` move on-chain at settlement. |
| Hiding the payer identity | No — channels bind depositor and counterparty addresses. |

### What the existing verifier actually provides

Despite the name, it is a Fiat-Shamir **hash** proof (`verifier::verify_proof`),
not a general zero-knowledge system (the docs note `bulletproofs`
integration as future work). Its own module docs state the limits:

| Field | Hidden? |
| :--- | :--- |
| `proof_key` | Yes — never submitted on-chain. |
| `commitment`, `nullifier`, `amount_threshold`, time window | No — public inputs. |
| Exact amount, `user_id` | Not accepted by the entrypoint at all. |

What it genuinely gives is **replay-safe threshold attestation**: "someone
paid at least X in window W" with a double-spend nullifier — useful for
subscription receipts, useless for hiding anything about a channel whose
settlement transaction reveals counterparty and balances anyway.

### Current wiring (verified, not assumed)

- Live in the **subscription** stack: `contracts/scripts/deploy.sh`,
  `sdk/src/zk/proof-generator.ts` (via `sdk/src/zk/index.ts` and the
  `client/lib/zk-proof.ts` stub), backend privacy routes/metrics/rate
  limiters, `.kiro` specs.
- **Absent from every v3 settlement path**: zero references in
  `packages/settlement`, `payment-channel`, `allowance`,
  `recurring_allowance`, or the backend channel services.

---

## Decision

- **Choice:** Archive — keep the code, tests, and error-code range; wire it
  into no v3 path; accept no new dependents.
- **Key Rationale:** It provides none of the three privacy properties v3
  could want under the channel model, while carrying the maintenance cost of
  a cryptographic component. Deleting real, tested work with an active
  subscription consumer (`deploy.sh`, SDK proofs, backend privacy endpoints)
  would be destruction without a customer benefit; archiving preserves the
  option value at near-zero cost.
- **Scope:** `contracts/contracts/zk-payment-verifier`, its SDK/client
  consumers, and v3 settlement scope boundaries. No behavior change anywhere.

### Considered and rejected

- **Carry forward as an optional v3 mode:** rejected — an optional mode of a
  component that hides nothing in the channel model is complexity theater;
  optionality must wait for properties worth paying for (real range proofs).
- **Delete:** rejected — the subscription stack still deploys and uses it;
  deletion belongs to a subscription-retirement decision, not v3.

### Reactivation criteria

Un-archiving requires a customer asking for a stated property **plus** a new
ADR showing the (then-current) construction provides it — e.g. integrated
range proofs actually hiding amounts, not threshold attestation.

### `stealth-derive`

The shared stealth-address helpers are client-side memo encoding with no
on-chain dependency. They stay exactly as they are: an optional client-side
mode, not a core-path dependency. Untouched by this decision beyond this
paragraph.

---

## Domain Naming & Data Model Compliance

> [!IMPORTANT]
> All architectural proposals must align with the canonical domain vocabulary and data model defined in [docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md](../DOMAIN_GLOSSARY_AND_DATA_MODEL.md).

| Domain Term / Entity | Layer Affected (Contracts, DB, API, Client, SDK) | Proposed Representation | Alignment with `docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md` |
| :--- | :--- | :--- | :--- |
| **Channel** | Contracts | Verifier explicitly out of scope | No model change |
| **Settlement** | Contracts | No ZK dependency on the settlement path | No model change |
| **Payment** | SDK, Client | `sdk/src/zk` remains subscription-era optional surface | No model change |

No other domain entities are affected. No DTO, route, or schema changes.

---

## Consequences

### Positive

- v3 settlement ships with no cryptographic privacy dependency it cannot
  justify; audit surface stays minimal.
- Subscription receipts keep working; nothing is deleted or broken.
- A future privacy customer gets a clear reactivation path instead of
  archaeology.

### Negative

- v3 offers no payment privacy beyond pseudonymous addresses; stated openly
  rather than implied by a `zk-` prefix.
- The archived contract still compiles in the workspace (deliberate — keeps
  the code alive and tested).

### Neutral

- Error-code range 1500–1599 stays reserved; no renumbering churn.

---

## Compliance & Verification

- `cargo check -p zk-payment-verifier`: clean (this change is comment- and
  docs-only).
- No reference to the verifier from `packages/settlement`, `payment-channel`,
  `allowance`, `recurring_allowance`, or backend channel services (verified by
  search; re-check if any v3 settlement file newly mentions it).
- Revisit when: a customer requests a stated v3 privacy property, or the
  subscription stack is retired (then re-evaluate delete vs keep).

---

## Compliance Checklist for Implementation PRs

- [x] Domain terminology adheres to [docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md](../DOMAIN_GLOSSARY_AND_DATA_MODEL.md)
- [ ] DTO types defined/updated in `@syncro/shared` (not applicable — no DTO change)
- [ ] API routes follow layer boundary rules (ADR-001) (not applicable — no route change)
- [ ] Database migrations placed in `supabase/migrations/` with RLS policies enabled (not applicable — no schema change)
