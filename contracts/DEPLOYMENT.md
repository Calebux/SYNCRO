# Contract Deployment Guide

## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-cli/install-and-setup) v21
+- Rust with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- * Funded Stellar account (testnet accounts can be funded via [Friendbot](https://friendbot.stellar.org))
- `STELLAR_SECRET_KEY` environment variable set to your account's secret key (`S...`)

Fund a new testnet account:
```bash
stellar keys generate --global deployer --network testnet --fund
export STELLAR_SECRET_KEY=$(stellar keys show deployer)
```

---

Testnet Deployment
-------------------

Run the deploy script from the `contracts/` directory:

```bash
cd contracts
bash scripts/deploy.sh testnet
```
This will::1. Build all five contracts to WASM
2. Deploy `SubscriptionRegistry`, `SubscriptionRenewal`, `SubscriptionLogging`, `ZkPaymentVerifier`, and `ContractUpgradeGovernance`
3. Run `init.sh` to initialize each contract and link the logging contract to the renewal contract
4. Print the contract addresses and save them to `scripts/deployed-addresses-testnet.env`

Section Start
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------0