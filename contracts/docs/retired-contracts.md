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
