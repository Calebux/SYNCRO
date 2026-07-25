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
1. Build all five contracts to WASM
2. Deploy `SubscriptionRegistry`, `SubscriptionRenewal`, `SubscriptionLogging`, `ZkPaymentVerifier`, and `ContractUpgradeGovernance`
3. Run `init.sh` to initialize each contract and link the logging contract to the renewal contract
4. Print the contract addresses and save them to `scripts/deployed-addresses-testnet.env`

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

## Manual Initialization (standalone)

If you deployed contracts separately and need to run init on its own:

```bash
export STELLAR_SECRET_KEY=<your_secret>
export SOROBAN_RENEWAL_ADDRESS=<renewal_contract_id>
export SOROBAN_LOGGING_ADDRESS=<logging_contract_id>

bash contracts/scripts/init.sh mainnet
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
5. After timelock expires, execute via `execute_upgrade()` then deploy new WASM
6. Rollback is available via `rollback_upgrade()` if needed

---

## Updating Backend Environment Variables

After deployment, copy the printed addresses into `backend/.env`:

```env
SOROBAN_REGISTRY_ADDRESS=<SubscriptionRegistry contract ID>
SOROBAN_RENEWAL_ADDRESS=<SubscriptionRenewal contract ID>
SOROBAN_LOGGING_ADDRESS=<SubscriptionLogging contract ID>
```

The addresses are also saved automatically to `contracts/scripts/deployed-addresses-<network>.env` after each run.

---

## Testnet Contract Addresses

Update this section after each testnet deployment.

| Contract               | Address |
|------------------------|---------|
| SubscriptionRegistry   | _(deploy and fill in)_ |
| SubscriptionRenewal    | _(deploy and fill in)_ |
| SubscriptionLogging    | _(deploy and fill in)_ |

Network: `testnet`  
Last deployed: _(fill in after first deployment)_
