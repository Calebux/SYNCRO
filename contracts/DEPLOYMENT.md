# Contract Deployment Guide

## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-and-setup) v21+
- Rust with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- A funded Stellar account (testnet accounts can be funded via [Friendbot](https://friendbot.stellar.org))
- `STELLAR_SECRET_KEY` environment variable set to your account's secret key (`S...`)

Fund a new testnet account:
```bash
stellar keys generate --global deployer --network testnet --fund
export STELLAR_SECRET_KEY=$(stellar keys show deployer)
```

---

## Testnet Deployment

Run the deploy script from the `contracts/` directory:

```bash
cd contracts
bash scripts/deploy.sh testnet
```

This will:
1. Build the `zk-payment-verifier` and `contract-upgrade` contracts to WASM
2. Deploy `ZkPaymentVerifier` and `ContractUpgradeGovernance`
3. Print the contract addresses and save them to `scripts/deployed-addresses-testnet.env`

> The subscription contracts (`subscription-registry`, `subscription-renewal`,
> `subscription-logging`, ...) were retired in #1660 and are no longer built or
> deployed by this script. See [docs/retired-contracts.md](docs/retired-contracts.md).
> Initialize the deployed contracts by invoking their `init` entrypoints with the
> Stellar CLI, or through the `deploy/` manifests used for v3.

---

## Mainnet Deployment Checklist

Before deploying to mainnet:

- [ ] Contracts audited and all tests passing (`cargo test`)
- [ ] Deployer account funded with sufficient XLM for contract storage fees
- [ ] Admin address is a multisig or hardware-wallet-controlled account
- [ ] `STELLAR_SECRET_KEY` is set to the mainnet deployer key (never commit this)
- [ ] You have a rollback plan (note current contract IDs if upgrading)

```bash
cd contracts
STELLAR_SECRET_KEY=<mainnet_secret> bash scripts/deploy.sh mainnet
```

---

## Contract Upgrade Procedure

Soroban contracts are upgraded using the `ContractUpgradeGovernance` contract, which implements a secure multi-sig governance process with timelock and rollback.

See [Contract Upgrade Runbook](../docs/ops/contract-upgrade-runbook.md) for the full upgrade procedure.

The upgrade process:
1. Build new WASM and compute its SHA-256 hash
2. A guardian proposes the upgrade via `propose_upgrade()`
3. 2-of-3 guardians approve via `approve_upgrade()`
4. A 48-hour timelock period begins (configurable)
5. After the timelock expires, deploy the new WASM and execute `execute_upgrade()`
6. Immediately call `migrate(from_version)` on the upgraded target contract. This is an admin-gated, one-version step; it rejects repeated and out-of-order calls. The upgrade-governance contract accepts either its admin or a guardian as the migration caller.
7. Verify `get_storage_version()` equals the new version and exercise a read of a pre-upgrade record before resuming normal writes
8. Rollback is available via `rollback_upgrade()` only for the WASM hash. It does not revert storage migrations or records lazily rewritten to the new schema; do not roll back after migration unless the previous WASM can read the migrated layout.

---

## Updating Backend Environment Variables

After deployment, copy the printed addresses into `backend/.env`:

```env
SOROBAN_ZK_VERIFIER_ADDRESS=<ZkPaymentVerifier contract ID>
SOROBAN_UPGRADE_ADDRESS=<ContractUpgradeGovernance contract ID>
```

The addresses are also saved automatically to `contracts/scripts/deployed-addresses-<network>.env` after each run.

---

## Testnet Contract Addresses

Update this section after each testnet deployment.

| Contract                   | Address |
|----------------------------|---------|
| ZkPaymentVerifier          | _(deploy and fill in)_ |
| ContractUpgradeGovernance  | _(deploy and fill in)_ |

Network: `testnet`  
Last deployed: _(fill in after first deployment)_
