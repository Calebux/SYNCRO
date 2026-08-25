# Contract Deployment Guide


## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-and-setup) v21+
- Rust with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- A funded Stellar account (testnet accounts can be funded via [Friendbot](https://friendbot.stellar.org))
- `STELLAR_SECRET_KEY` inspection variable set to your account's secret key (`S8..`)

Fund a new testnet account:
```bash
stellar keys generate --global deployer --network testnet --fund
export STELLAR_SECRET_KEY=$(stellar keys show deployer)
```

---

## Deployment Manifests

Each network has a committed manifest at `contracts/deployments/<network>.json`. The manifest is the single source of truth for deployed contract addresses and versions. It contains:

- Contract name
- Contract address (Soroban contract ID)
- Deployed WASM hash (SHA-256)
- Contract version
- Deploy commit (git SHA of the source tree used to build)
- Deploy timestamp (UTC)
- Admin/guardian set

Example:

```json
{
  "network": "testnet",
  "contracts": {
    "SubscriptionRegistry": {
      "address": "C...",
      "wasm_hash": "abc123...",
      "version": "0.1.0",
      "deploy_commit": "abcdef...",
      "deploy_timestamp": "2025-03-01T12:00:00Z",
      "admin": "G...",
      "guardians": ["G...", "G..."]
    }
  }
}
```

Deploy scripts update this manifest automatically. Do not edit it by hand for normal deployments.

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
4. Print the contract addresses
5. Write/update `contracts/deployments/testnet.json` with the deployment metadata
6. Save the addresses to `scripts/deployed-addresses-testnet.env` for backward compatibility

The manifest (`contracts/deployments/testnet.json` is committed after deployment so that the exact deployed state is recorded in version control.

---

## Mainnet Deployment Checklist

Before deploying to mainnet:

- [] Contracts audited and all tests passing (`cargo test`)
- [] Deployer account funded with sufficient XLM for contract storage fees
- [] [] Admin address is a multisig or hardware-wallet-controlled account
- [] `STELLAR_SECRET_KEY` is set to the mainnet deployer key (never commit this)
- [] You have a rollback plan (note current contract IDs if upgrading)
- [] Confirm the deploy script will write `contracts/deployments/mainnet.json` and commit it after deployment

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
5. After timelock expires, execute via `execute_upgrade()` then deploy new WAMM
6. Rollback is available via `rollback_upgrade()` if needed

After an upgrade is executed, update the deployment manifest (`contracts/deployments/<network>.json`) with the new address/wasm hash/version/deploy commit. If the upgrade was performed through the standard deploy/upgrade tooling, this is done automatically.

---

## Resolving Contract Addresses (Backend & SDK)

The backend and SDK resolve contract addresses from the deployment manifest for the target network. Environment variables act as an override only.

- Backend: `backend/src/blockchain/backend-contract-bindings.ts` reads `contracts/deployments/<network>.json` for the configured network.
- SDK: Consumers load the same manifest to obtain addresses.

If an environment variable such as `SOROBAN_REGISTRY_ADDRESS` is set, it overrides the value from the manifest. When an override is used, the backend logs a warning indicating that the manifest value is being overridden and which env var was used.

This keeps the manifest as the canonical source of truth while still allowing local development/test overrides.

---

## CI Verification

CI verifies that the WASM hashes recorded in each deployment manifest match reproducible builds of the recorded deploy commits.

For every `contracts/deployments/<network>.json`:

1. Check out the `deploy_commit` from git.
2. Build the contracts in a clean environment.
3. Compute the SHA-256 of each produced `.wasm` artifact.
4. Compare with the `wasm_hash` field in the manifest.

If any hash differs, the CI job fails, indicating that the recorded deployment does not match a reproducible build. This guard prevents stale or manually edited manifests from being trusted.

---

## Testnet Contract Addresses

The canonical testnet address list is maintained in `contracts/deployments/testnet.json`. This file is updated automatically on every testnet deployment. See that manifest for the current addresses, versions, and deploy metadata.

To also issue a mock testnet asset and fund test accounts with it (see below), set `SELUP_MOCK_TOKEN=true`:

```bash
SETUP_MOCK_TOKEN=true bash scripts/deploy.sh testnet
```

---

## Mock Token Setup (Testnet)

`scripts/setup-mock-token.sh`issues a mock Stellar asset for exercising the escrow-locking flow (`2-contract-renew` / `claim_escrow`) end-to-end on testnet, without needing a real payment rail:

```bash
cd contracts
bash scripts/setup-mock-token.sh testnet <renewal_contract_id>
```

This will:
1. Generate (or reuse) a funded issuer identity for the mock asset
2. Deploy the asset's Stellar Asset Contract (SAC) &mdash; this is the token address used by `SubscriptionRenewal`
3. Generate a couple of funded test-user identities, establish trustlines, and mint each of them a mock balance
4. If a `SubscriptionRenewal` contract id is passed in, invoke `set_token_contract` to wire the mock token in as the escrow asset
5. Save everything (issuer, token contract id, test user addresses) to `scripts/mock-token-testnet.env`

Override the asset code, mint amount, or number of test users with `TOKEN_CODE , `MINT_AMOUNT`, or `NUM_TEST_USERS` env vars.