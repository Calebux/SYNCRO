# Guardian Contract

A shared guardian contract that can pause/unpause a registered set of contracts in one call for incident response.

## Overview

The Guardian Contract provides a centralized emergency stop mechanism for managing multiple pausable contracts. This is critical for incident response scenarios where you need to quickly pause all contract operations across the platform.

## Features

✅ **Contract Registration**: Register target contracts to be managed by the guardian  
✅ **One-Shot Pause/Unpause**: Pause or unpause all registered contracts in a single transaction  
✅ **Guardian Multisig**: Controlled by a multisig address for security  
✅ **Incident Response**: Fast emergency response capabilities  
✅ **Contract Tracking**: Monitor which contracts are registered and their pause status  

## Architecture

```
┌─────────────────────────────────────────┐
│      Guardian Contract (Multisig)       │
│  ┌─────────────────────────────────┐   │
│  │  - initialize()                  │   │
│  │  - register_contract()           │   │
│  │  - unregister_contract()         │   │
│  │  - emergency_pause_all()         │   │
│  │  - emergency_unpause_all()       │   │
│  └─────────────────────────────────┘   │
└──────────────┬──────────────────────────┘
               │
               │ Manages
               │
       ┌───────┴───────┬─────────────┬──────────────┐
       │               │             │              │
       ▼               ▼             ▼              ▼
┌──────────┐   ┌─────────────┐  ┌─────────┐  ┌─────────┐
│Allowance │   │Subscription │  │ Escrow  │  │Virtual  │
│Contract  │   │  Renewal    │  │Contract │  │  Card   │
└──────────┘   └─────────────┘  └─────────┘  └─────────┘
```

## Usage

### 1. Initialize the Guardian

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let guardian_multisig = Address::generate(&env);

guardian_contract.initialize(&guardian_multisig);
```

### 2. Register Contracts

```rust
let allowance_contract = Address::from_str("GXXXX...");
let subscription_contract = Address::from_str("GYYY...");

guardian_contract.register_contract(
    &allowance_contract,
    &String::from_str(&env, "Allowance")
);

guardian_contract.register_contract(
    &subscription_contract,
    &String::from_str(&env, "SubscriptionRenewal")
);
```

### 3. Emergency Pause (Incident Response)

```rust
// When an incident is detected, pause all contracts immediately
let paused_count = guardian_contract.emergency_pause_all();
// Returns the number of contracts successfully paused
```

### 4. Resume Operations

```rust
// After incident resolution, unpause all contracts
let unpaused_count = guardian_contract.emergency_unpause_all();
// Returns the number of contracts successfully unpaused
```

### 5. Query Contract Status

```rust
// Get all registered contracts
let contracts = guardian_contract.get_registered_contracts();

// Check if a specific contract is registered
let is_registered = guardian_contract.is_contract_registered(&contract_addr);

// Get the count of registered contracts
let count = guardian_contract.get_contract_count();

// Get the guardian address
let guardian = guardian_contract.get_guardian();
```

## Contract Interface

### Admin Functions

- `initialize(guardian: Address)` - Initialize with multisig guardian (one-time)
- `register_contract(contract: Address, name: String)` - Add contract to managed set
- `unregister_contract(contract: Address)` - Remove contract from managed set

### Emergency Functions

- `emergency_pause_all() -> u32` - Pause all registered contracts
- `emergency_unpause_all() -> u32` - Unpause all registered contracts

### Query Functions

- `get_guardian() -> Address` - Get the guardian multisig address
- `get_registered_contracts() -> Vec<RegisteredContract>` - Get all registered contracts
- `get_contract_count() -> u32` - Get count of registered contracts
- `is_contract_registered(contract: Address) -> bool` - Check registration status

## Data Structures

### RegisteredContract

```rust
pub struct RegisteredContract {
    pub address: Address,           // Contract address
    pub name: String,                // Human-readable name
    pub paused: bool,                // Current pause status
    pub registered_at: u64,          // Registration timestamp
}
```

## Events

The Guardian Contract emits the following events:

- `GuardianInitialized` - When guardian is initialized
- `ContractRegistered` - When a contract is registered
- `ContractUnregistered` - When a contract is unregistered
- `EmergencyPauseAll` - When all contracts are paused
- `EmergencyUnpauseAll` - When all contracts are unpaused
- `PauseOperationFailed` - When a pause/unpause operation fails for a specific contract

## Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 1 | `AlreadyInitialized` | Guardian already initialized |
| 2 | `NotInitialized` | Guardian not initialized yet |
| 3 | `Unauthorized` | Caller is not the guardian |
| 4 | `ContractAlreadyRegistered` | Contract already in registry |
| 5 | `ContractNotFound` | Contract not in registry |
| 6 | `NoContractsRegistered` | No contracts to pause/unpause |
| 7 | `InvalidAddress` | Invalid address provided |

## Security Considerations

### Multisig Guardian

The guardian MUST be a multisig address to prevent single points of failure:

- Recommended: 3-of-5 or 2-of-3 multisig
- Members should be distributed across multiple security domains
- Consider using hardware wallets for multisig keys

### Pausable Contract Requirements

For contracts to be compatible with the Guardian:

1. Must implement `set_paused(paused: bool)` function
2. Must have proper access control on pause function
3. Should emit pause/unpause events

Example implementation:

```rust
pub fn set_paused(env: Env, paused: bool) {
    Self::require_admin(&env);
    env.storage().instance().set(&DataKey::Paused, &paused);
    PauseToggled { paused }.publish(&env);
}
```

### Incident Response Process

1. **Detect**: Monitor for suspicious activity or vulnerabilities
2. **Pause**: Call `emergency_pause_all()` immediately
3. **Investigate**: Analyze the incident while contracts are paused
4. **Fix**: Deploy patches or mitigations
5. **Resume**: Call `emergency_unpause_all()` after verification

## Testing

Run the test suite:

```bash
cd contracts
cargo test -p guardian
```

The test suite covers:

- ✅ Initialization and access control
- ✅ Contract registration and unregistration
- ✅ Emergency pause/unpause operations
- ✅ Authorization checks
- ✅ Query functions
- ✅ Full incident response workflow
- ✅ Edge cases and error conditions

## Building

Build the WASM contract:

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release -p guardian
```

The compiled contract will be at:
```
target/wasm32-unknown-unknown/release/guardian.wasm
```

## Deployment

1. Build the contract (see above)
2. Deploy to Stellar network:

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/guardian.wasm \
  --source <DEPLOYER_SECRET> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

3. Initialize with guardian multisig:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <GUARDIAN_SECRET> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- initialize \
  --guardian <MULTISIG_ADDRESS>
```

4. Register target contracts:

```bash
soroban contract invoke \
  --id <GUARDIAN_CONTRACT_ID> \
  --source <GUARDIAN_SECRET> \
  -- register_contract \
  --contract <TARGET_CONTRACT_ADDRESS> \
  --name "ContractName"
```

## Integration Example

Here's a complete example of integrating the Guardian with existing contracts:

```rust
use soroban_sdk::{contract, contractimpl, Address, Env, String};

// In your main contract initialization script
pub fn setup_guardian_system(env: &Env) {
    // 1. Deploy guardian contract
    let guardian_contract_id = env.register_contract(None, GuardianContract);
    let guardian_client = GuardianContractClient::new(env, &guardian_contract_id);
    
    // 2. Initialize with multisig
    let multisig = Address::generate(env);
    guardian_client.initialize(&multisig);
    
    // 3. Register all pausable contracts
    let allowance_addr = Address::generate(env);
    let subscription_addr = Address::generate(env);
    let escrow_addr = Address::generate(env);
    
    guardian_client.register_contract(
        &allowance_addr,
        &String::from_str(env, "Allowance")
    );
    guardian_client.register_contract(
        &subscription_addr,
        &String::from_str(env, "SubscriptionRenewal")
    );
    guardian_client.register_contract(
        &escrow_addr,
        &String::from_str(env, "Escrow")
    );
    
    // 4. Verify setup
    assert_eq!(guardian_client.get_contract_count(), 3);
}
```

## Monitoring and Alerts

Consider setting up monitoring for Guardian events:

```javascript
// Example monitoring setup (off-chain)
const guardianContract = new Contract(GUARDIAN_ADDRESS);

// Monitor emergency pause events
guardianContract.on('EmergencyPauseAll', (event) => {
  console.error('🚨 EMERGENCY: All contracts paused!', {
    guardian: event.guardian,
    count: event.contracts_paused,
    timestamp: event.timestamp
  });
  
  // Send alerts to incident response team
  notifyTeam('Emergency pause activated');
});

// Monitor unpause events
guardianContract.on('EmergencyUnpauseAll', (event) => {
  console.log('✅ Operations resumed', {
    count: event.contracts_unpaused,
    timestamp: event.timestamp
  });
});
```

## Roadmap

### Future Enhancements

- [ ] Time-delayed unpause for additional safety
- [ ] Per-contract granular pause control
- [ ] Pause reason tracking
- [ ] Automated incident detection integration
- [ ] Emergency upgrade capability
- [ ] Pause duration limits
- [ ] Guardian rotation mechanism

## License

See main project LICENSE file.

## Support

For issues or questions:
- Open a GitHub issue
- Contact the Smart Contracts Team
- See main project documentation at `/docs`
