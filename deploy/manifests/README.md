Durable environment manifests

Each JSON file records deployment metadata for an environment (e.g. `testnet.json`, `mainnet.json`).

Fields:
- `network` - network id (testnet|mainnet|futurenet)
- `sorobanContractAddress` - deployed contract address
- `sorobanRpcUrl` - optional RPC URL used for deployment
- `stellarNetworkUrl` - optional Stellar network URL
- `deployedAt` - ISO timestamp when deployed
- `commitSha` - optional git commit sha for the deployment

Deployment pipelines should write a manifest to `deploy/manifests/<network>.json`.
