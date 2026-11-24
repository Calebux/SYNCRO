# Guardian Selective Pause - 1% Implementation

## Overview

This PR implements the first 1% of selective pause functionality for SYNCRO payment channels, enabling critical bug response without freezing user withdrawals. The guardian contract can pause dangerous operations while preserving users' ability to close channels and recover funds.

## What Was Implemented

### Core Pause Functionality

**File**: `contracts/contracts/payment-channel/src/lib.rs`

**Functions Added**:
- `pause()` - Admin-only function to pause new operations
- `unpause()` - Admin-only function to resume operations
- `is_paused()` - Query pause status with auto-expiry info
- `set_paused(bool)` - Guardian-compatible interface
- `check_paused()` - Internal helper with auto-expiry logic

**Key Features**:
- ✅ Selective operation blocking (open/top_up/payments blocked, closes allowed)
- ✅ Auto-expiry after 7 days (`ESCAPE_HATCH_GRACE_PERIOD_SECS`)
- ✅ Guardian contract integration via `set_paused(bool)`
- ✅ Comprehensive test suite demonstrating behavior

### Selective Pause Rules

**BLOCKED Operations** (while paused):
- `open_channel()` - No new channels can be opened
- `top_up()` - No new funds can be added
- `verify_payment_proof()` - No new payments accepted

**ALLOWED Operations** (always work):
- `initiate_close()` - Users can start channel closure
- `dispute()` - Users can submit newer states
- `finalize()` - Users can withdraw after dispute window
- `submit_state()` - Cooperative state updates still work
- `get_channel()` - Queries always work

### Auto-Expiry Mechanism

```rust
pub const ESCAPE_HATCH_GRACE_PERIOD_SECS: u64 = 7 * 24 * 60 * 60; // 7 days
```

- Pause auto-expires after 7 days
- Prevents indefinite custody lock
- Checked lazily on every operation
- Emits `autoexp` event when auto-expiring

### Storage

- `DataKey::PausedSince` - Unix timestamp when pause started
- Key absent = not paused
- Key present = paused (until expiry)

### Events

```rust
(symbol_short!("contract"), symbol_short!("paused"))   // Pause activated
(symbol_short!("contract"), symbol_short!("unpaused")) // Manually unpaused
(symbol_short!("contract"), symbol_short!("autoexp"))  // Auto-expired
```

## Usage Example

### Manual Pause/Unpause

```rust
// Admin pauses contract
payment_channel.pause();

// Check status
let (is_paused, paused_since, expires_at) = payment_channel.is_paused();
// Returns: (true, 1234567890, 1235172690)

// Admin unpauses
payment_channel.unpause();
```

### Guardian Integration

```rust
// Guardian contract calls set_paused(true) during incident
guardian.emergency_pause_all();
// → payment_channel.set_paused(true) is called

// After resolution
guardian.emergency_unpause_all();
// → payment_channel.set_paused(false) is called
```

### Auto-Expiry

```rust
// Pause starts
payment_channel.pause(); // at timestamp 1000

// 7 days pass (604,800 seconds)
// User tries to close channel at timestamp 605,800

// Auto-expiry kicks in automatically
let (is_paused, _, _) = payment_channel.is_paused();
// Returns: (false, 0, 0) - pause expired!

// Now operations work again without manual unpause
payment_channel.open_channel(...); // ✅ Succeeds
```

## Test Suite

**File**: `contracts/contracts/payment-channel/src/selective_pause.rs`

**Tests**:
1. `test_pause_blocks_open_allows_close` - Core selective behavior
2. `test_pause_blocks_top_up` - Top-up blocking
3. `test_pause_auto_expires_after_grace_period` - Auto-expiry at 7 days
4. `test_unpause_before_expiry` - Manual unpause
5. `test_set_paused_guardian_interface` - Guardian integration
6. `test_double_pause_idempotent` - Pause idempotency
7. `test_unpause_when_not_paused_errors` - Error handling

### Key Test: Selective Pause

```rust
#[test]
fn test_pause_blocks_open_allows_close() {
    // 1. Open channel before pause ✅
    let channel_id = client.open_channel(...).unwrap();
    
    // 2. Pause contract
    client.pause();
    
    // 3. Opening new channels FAILS ❌
    let result = client.try_open_channel(...);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    
    // 4. Closing existing channel SUCCEEDS ✅
    client.initiate_close(...).unwrap();
    
    // 5. Dispute SUCCEEDS ✅
    client.dispute(...).unwrap();
    
    // 6. Finalize SUCCEEDS ✅
    client.finalize(...).unwrap();
}
```

## Integration with Guardian Contract

The existing guardian contract (`contracts/contracts/guardian/`) can now manage payment channels:

```rust
// 1. Register payment-channel contract with guardian
guardian.register_contract(
    &payment_channel_address,
    &String::from_str(&env, "PaymentChannel"),
);

// 2. During incident: pause all contracts
guardian.emergency_pause_all();
// → Calls payment_channel.set_paused(true)

// 3. After resolution: unpause all
guardian.emergency_unpause_all();
// → Calls payment_channel.set_paused(false)
```

## Acceptance Criteria Met

From the original issue:

- ✅ **Define what can be paused**: `open`, `top_up`, `verify_payment_proof`
- ✅ **Define what cannot be paused**: `initiate_close`, `dispute`, `finalize`
- ✅ **Test shows opens fail**: `test_pause_blocks_open_allows_close`
- ✅ **Test shows closes succeed**: Same test verifies close path works
- ✅ **Auto-expiry**: `test_pause_auto_expires_after_grace_period`
- ✅ **Pause expires on its own**: After 7 days without manual intervention

## Files Changed/Added

```
M  contracts/contracts/payment-channel/src/lib.rs  # Added pause functions (~100 lines)
A  contracts/contracts/payment-channel/src/selective_pause.rs  # Test suite (~250 lines)
A  GUARDIAN_PAUSE_IMPLEMENTATION.md  # This documentation
```

## Current Limitations (1% Implementation)

Intentionally not implemented (future work):

- ❌ **Escape hatch withdrawal**: After 7 days, users can't unilaterally withdraw yet (needs `escape_hatch_withdraw()`)
- ❌ **Virtual card pause**: Agent spend caps not integrated yet
- ❌ **Per-operation pause flags**: Only binary pause/unpause (no granular control)
- ❌ **Pause reason metadata**: No on-chain explanation for why pause occurred
- ❌ **Multi-sig pause**: Only single admin can pause (guardian provides multi-sig)

## Design Decisions

### Why 7 Days?

- Balance between admin response time and user protection
- Matches compile-time constant `ESCAPE_HATCH_GRACE_PERIOD_SECS`
- Long enough to coordinate resolution, short enough to prevent custody concerns
- Already defined in original contract constants

### Why Block at Entry?

```rust
if Self::check_paused(&env) {
    return Err(Error::Unauthorized);
}
```

- Simple, fail-fast approach
- Minimal code changes (single check per function)
- Clear error signal (Unauthorized means "operation not allowed now")
- Auto-expiry happens lazily during checks

### Why Allow Closes?

**Non-custodial guarantee must hold:**
> A payer can always recover their funds without the provider's cooperation

Blocking closes would violate this core invariant. Even during critical bugs, users must retain withdrawal ability.

## Next Steps (Remaining 99%)

To complete full guardian pause functionality:

### Phase 1: Escape Hatch (10%)
- Implement `escape_hatch_withdraw()` for unilateral withdrawal after grace period
- Add per-channel withdrawal flags to prevent double-withdrawals
- Tests for escape hatch scenarios

### Phase 2: Virtual Card Integration (20%)
- Add `set_paused()` to virtual-card contract
- Decide what operations to block (issue_cap vs can_transact)
- Coordinate pause across multiple contract types

### Phase 3: Enhanced Pause Metadata (30%)
- Store pause reason on-chain
- Add emergency contact information
- Richer query APIs for pause status

### Phase 4: Granular Controls (40%)
- Per-operation pause flags (pause opens but allow top-ups)
- Rate-limited unpause for gradual recovery
- Multi-level pause severity (warning, pause, freeze)

## Running Tests

```bash
cd contracts/contracts/payment-channel

# Run all tests
cargo test

# Run only selective pause tests
cargo test selective_pause

# Run specific test
cargo test test_pause_blocks_open_allows_close

# With output
cargo test selective_pause -- --nocapture
```

## Branch

- Branch: `feature/guardian-selective-pause`
- Fork: https://github.com/coderolisa/SYNCRO.git
- Ready for PR creation

## Security Considerations

1. **Admin-only pause**: Only contract admin (or guardian via set_paused) can pause
2. **Auto-expiry prevents permanent lock**: 7-day maximum custody period
3. **Close path always open**: Non-custodial guarantee preserved
4. **Idempotent operations**: Multiple pause calls don't cause issues
5. **Lazy expiry**: No cron needed, checks happen during operations

## Notes

- **WebAssembly compatible**: Pure Soroban contract, no external dependencies
- **Gas efficient**: Single storage read per paused operation check
- **Backward compatible**: Existing channels work unchanged (pause starts at `None`)
- **Guardian compatible**: Implements expected `set_paused(bool)` interface
