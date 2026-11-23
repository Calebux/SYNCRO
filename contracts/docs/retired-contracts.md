# Retired subscription contracts (issue #1660)

The v3 product no longer uses the subscription stack. Its contracts were removed
from the Cargo workspace so that every contracts CI run builds and tests only
code v3 depends on.

## What was removed

| Crate | Error range (reserved) |
| --- | --- |
| `subscription-registry` | none allocated |
| `subscription-renewal` | 1000-1099 |
| `subscription-logging` | 1100-1199 |
| `voucher-ledger` | 2000-2099 |
| `subscription-refund` | 2300-2399 |
| `recurring-allowance` | 2400-2499 |
| `loyalty-rewards` | 2500-2599 |
| `subscription-nft` | 2600-2699 |

Also removed, because nothing else used them:

* `contracts/integration-tests` (crate `subscription-integration-tests`). Its
  tests covered only subscription flows, and `error_registry_tests.rs` imported
  `syncro_common::ContractErrorBase` without declaring the dependency, so it did
  not build as configured.
* `contracts/common` (crate `syncro-common`). Its only consumer was
  `subscription-renewal`. The v3 crates use `syncro-contract-common`
  (`contracts/contracts/common`), which provides the same `next_counter_id`.
* `scripts/init.sh` and `scripts/setup-mock-token.sh`, which only initialized and
  funded the retired contracts. `scripts/deploy.sh` now builds and deploys only
  `zk-payment-verifier` and `contract-upgrade`.
* The `subscription-renewal` and `subscription-logging` entries of
  `budgets.json`, and `-p subscription-renewal` from the fuzz-test commands in
  `.github/workflows/contracts.yml`.

## Why this was safe

Before deleting, every remaining crate's `Cargo.toml` was checked: none had a
path dependency on a retired crate. The only dependents were
`integration-tests` (removed) and the CI workflow (updated). The
`Cargo.lock` change removes only workspace packages, no registry dependencies.

## Archive

The code is preserved in git history at the tag `archive/subscription-contracts`
(the last commit on `main` before this change). To get it back:

```bash
git fetch origin tag archive/subscription-contracts
git checkout -b restore-subscription-contracts archive/subscription-contracts
```

## Rules for the reserved error ranges

Retired error ranges stay in `ERROR_CODE_REGISTRY.md` and `errors.json`. Do not
give them to a new contract: their codes may still appear in on-chain history,
indexer data and backend logs.

## Deployed instances

Removing the source does not remove contracts already deployed on a network.
Those instances keep running until they are retired on-chain. Nothing in this
repository builds, upgrades or deploys them any more.

## Still to clean up outside `contracts/`

These are not part of the Cargo workspace and were left alone on purpose:

* `docs/DEPLOYMENT_RUNBOOK.md`, `docs/ops/contract-upgrade-runbook.md` and
  `docs/adr/ADR-017-*.md` still describe the subscription deployment flow.
* `scripts/generate-contract-types.mjs`, `shared/src/generated/*` and
  `shared/src/logic/soroban-contract-interfaces.ts` still list the retired
  contract interfaces.
* Legacy backend services (`contract-version-manager`, renewal cooldown,
  reconciliation invariants, risk detection) still mention `subscription_renewal`.

---

# Retired v3 metered-rails contracts (issue #1837)

`allowance`, `payment-adapter` and `stealth-announcement` were removed from the
Cargo workspace. None of them has a v3 consumer, and each is either superseded
by an off-chain component or belongs to a product line v3 does not ship.

## Decisions

| Crate | Decision | Why |
| --- | --- | --- |
| `allowance` | **Delete** | Superseded by the off-chain spend cap. v3 enforces per-agent / per-route spend limits in `backend/src/services/v3/spend-cap-service.ts` and `packages/metering`, not on-chain. No crate or backend service calls the contract. |
| `payment-adapter` | **Delete** | Belongs to the subscription renewal stack retired in #1660 — its only settlement entrypoint (`settle_renewal`) and `RenewalSettled` event exist to settle subscription renewals. Nothing in v3 calls it. |
| `stealth-announcement` | **Delete** | v3 privacy is off-chain (`shared/src/logic/stealth-*`, `backend/src/services/stealth-scanner.ts`, Supabase). The on-chain announcement registry has no v3 reader or writer; the off-chain stealth tests use `shared/src/crypto/stealth-derive`, not this contract. |

## What was removed

| Crate | Error range (reserved) |
| --- | --- |
| `allowance` | 1800-1899 |
| `payment-adapter` | 1900-1999 |
| `stealth-announcement` | 3100-3199 |

Also updated to drop the removed crates:

* `contracts/Cargo.toml` members and the matching `contracts/Cargo.lock` package
  entries (workspace packages only; no registry dependencies changed).
* The project-structure and "Implemented Contracts" sections of
  `contracts/README.md`, plus the negative-path matrix rows for their
  entrypoints.
* `TOKEN_TRANSFER_CRATES` in
  `contracts/scripts/check-negative-path-coverage.mjs`.
* `docs/architecture.md`, which now publishes the final contract set.

## Why this was safe

Every remaining crate's `Cargo.toml` was checked: none has a path dependency on
a removed crate. Outside the workspace, no backend service, SDK module, deploy
script or CI job references them — they are absent from `budgets.json`,
`scripts/deploy.sh`, the deploy manifests and the CI fuzz `-p` lists.
`contracts/scripts/check-negative-path-coverage.mjs` discovers crates from the
filesystem, so removing the directories drops them from the matrix
automatically.

## Rules for the reserved error ranges

As with the #1660 retirements, blocks 1800-1899, 1900-1999 and 3100-3199 stay
reserved in `ERROR_CODE_REGISTRY.md` and `errors.json`, and the base-code maps in
`contracts/scripts/*.py` are left intact. Their codes may still appear in
on-chain history, indexer data and backend logs, and `sdk/src/errors.ts` still
decodes them.

## Still to clean up outside `contracts/`

These are not part of the Cargo workspace and were left alone on purpose:

* `docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md` and
  `shared/src/types/domain-glossary.ts` still map Payment / Stealth Payment to
  the retired contracts.
* `docs/security/settlement_audit_report.md` still lists `allowance` in the
  settlement-path target architecture, and `docs/adr/ADR-017-*.md` still names
  it (ADRs are historical records).
* `contracts/docs/contract-event-schema.md` and
  `contracts/contracts/guardian/README.md` still show `allowance` as an example
  event family / registered contract, alongside the previously retired
  subscription examples.
