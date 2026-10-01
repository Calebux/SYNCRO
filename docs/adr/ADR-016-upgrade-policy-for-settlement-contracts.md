# ADR-016: Upgrade Path and Versioning for the Settlement Contracts

**Status:** Proposed
**Date:** 2026-09-28
**Deciders:** Contracts and Backend teams
**Issue:** [#1435](https://github.com/Calebux/SYNCRO/issues/1435)
**Related ADRs:** [ADR-005](./ADR-005-payment-channels-for-renewals.md), [ADR-006](./ADR-006-funds-in-escrow.md)

---

## Context

`contract-upgrade` (2-of-3 guardian multisig, 48h default timelock, per-target
rollback hash) was built for the subscription contracts. The settlement
contracts hold user funds, so an upgrade must not be able to change the balance
semantics of channels that are already open.

Before this ADR, six contracts exposed no `version()` / `interface_version()`
accessor at all (`agent-registry`, `fee-collector`, `fx-oracle`,
`subscription_logging`, `subscription_renewal`, `zk-payment-verifier`), and the
backend signed channel states without ever checking which contract version it
was signing for.

---

## Decision

- **Choice:** Governed upgrades for shared settlement logic, no in-place
  upgrade of a live channel's balances, and a client-side version refusal.
- **Key Rationale:** Balance and challenge-period fields of an open channel are
  safety-critical; they must only ever be read, never reinterpreted, by newer
  code. The version gate turns a deployment skew into a loud signing refusal
  instead of a silent semantic change.
- **Scope:** Soroban contracts under `contracts/contracts/`, the
  `contract-upgrade` governance contract, and
  `backend/src/services/payment-channel-service.ts`.

### Upgradeable vs immutable

| Contract(s) | Upgrade path | Reasoning |
| :--- | :--- | :--- |
| `payment-channel` (live instance holding balances) | **No in-place upgrade.** There is no `migrate` entrypoint on the contract today, and none may be added that rewrites `balance_a` / `balance_b`, `total_deposited`, or the per-channel challenge window of an open channel. Logic changes ship as a new deployment; open channels close out or migrate by mutual agreement. | Reinterpreting stored balances is the exact failure this policy exists to prevent. |
| `allowance`, `recurring_allowance`, `escrow`, `fee-collector`, `payment-splitter`, `payment-adapter`, `resolver-registry`, `fx-oracle`, `guardian`, `attestation`, `voucher-ledger`, `loyalty_rewards`, `virtual-card`, `stealth-announcement`, `subscription_*`, `agent-registry` | Upgradeable **only** through `contract-upgrade`: 2-of-3 guardian approvals (`REQUIRED_APPROVALS`), 48h default timelock (`DEFAULT_TIMELOCK_SECONDS = 172_800`), per-target rollback WASM hash recorded before execution. | Shared logic with no per-user balance rows at rest, or with timelocked treasury flows (`fee-collector` withdrawals already require the same delay). |

### Authorization and delay

Propose → 2-of-3 guardian approvals → 48h timelock → execute, all inside
`contract-upgrade`. Per-target timelock overrides (`ContractTimelock`) may only
*lengthen* the delay for funds-touching contracts, never shorten it below 48h.
The pre-upgrade WASM hash is stored via the rollback facility so a bad upgrade
can be reverted through the same governed path.

### Open-channel guarantee

An upgrade must not retroactively alter an open channel's deposited balance or
its challenge period. This holds by construction plus process:

1. No storage migration may change the type or meaning of persisted
   balance/challenge fields — append-only schema evolution only.
2. The backend refuses to sign channel states when the observed on-chain
   `interface_version` differs from `EXPECTED_CHANNEL_CONTRACT_VERSION`
   (`ContractVersionMismatchError`, code `CONTRACT_VERSION_MISMATCH`).
3. Every contract exposes `version()` (implementation) and
   `interface_version()` (ABI), delegating to `syncro-contract-common`, so the
   observed version is always queryable. The six contracts that lacked them are
   added in this change.

### Known gap

`subscription_renewal` does not compile on `main` (pre-existing brace-level
damage around the failure-path helpers, reproducible on pristine
`upstream/main`). Its accessors are present in the source but not yet
compilable; repairing that file is out of scope here and tracked separately.

---

## Domain Naming & Data Model Compliance

> [!IMPORTANT]
> All architectural proposals must align with the canonical domain vocabulary and data model defined in [docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md](../DOMAIN_GLOSSARY_AND_DATA_MODEL.md).

| Domain Term / Entity | Layer Affected (Contracts, DB, API, Client, SDK) | Proposed Representation | Alignment with `docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md` |
| :--- | :--- | :--- | :--- |
| **Channel** | Contracts, Backend | Live `payment-channel` instance is not upgraded in place; version gate on signing | No model change |
| **Settlement** | Contracts, Backend | Governed upgrades only; 48h minimum delay | No model change |
| **Escrow** | Contracts | Governed upgrades only | No model change |
| **Payment** | Backend | `CONTRACT_VERSION_MISMATCH` refusal before signing | No model change |

No other domain entities are affected.

---

## Consequences

### Positive

- Open-channel balances and challenge periods cannot be silently reinterpreted
  by a deploy.
- Version skew between backend and chain fails closed at signing time with a
  typed error operators can alert on.
- Every contract is version-queryable, so future migrations can assert
  preconditions on-chain.

### Negative

- Emergency fixes to settlement logic still wait out the 48h timelock; the
  escape hatch is the per-channel withdrawal path, not a fast upgrade.
- Callers that observe the on-chain version must thread it through
  (`applyOffChainRenewal(..., { contractVersion })`); until the submission
  path fetches it live, the gate defaults to the expected version.

### Neutral

- `payment-channel` logic improvements require deploying a new instance and
  migrating channels, which is operationally heavier than an in-place upgrade.

---

## Compliance & Verification

- `cargo check` on the touched contracts (all green except pre-existing
  `subscription_renewal` breakage).
- `backend/tests/payment-channel-version.test.ts`: accepts the expected
  version; rejects stale, future, and unknown versions; proves
  `applyOffChainRenewal` refuses before any DB access.
- Revisit when: the settlement submission path fetches `interface_version`
  live, or a `payment-channel` migration entrypoint is proposed (requires a
  new ADR proving balance/challenge preservation).

---

## Compliance Checklist for Implementation PRs

- [x] Domain terminology adheres to [docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md](../DOMAIN_GLOSSARY_AND_DATA_MODEL.md)
- [ ] DTO types defined/updated in `@syncro/shared` (not applicable — no DTO change)
- [ ] API routes follow layer boundary rules (ADR-001) (not applicable — no route change)
- [ ] Database migrations placed in `supabase/migrations/` with RLS policies enabled (not applicable — no schema change)
