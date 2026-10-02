# Renewal Time Window Feature

## Overview
Restricts renewal execution to a defined time window to prevent renewals from executing too early or too late relative to the billing schedule.

## Contract Changes

### New Storage
- `WindowKey` - Storage key for renewal windows per subscription
- `RenewalWindow` - Struct containing `billing_start` and `billing_end` timestamps

### New Functions
- `set_window(sub_id, billing_start, billing_end)` - Set renewal window (owner only)
- `get_window(sub_id)` - Query current renewal window

### Updated Functions
- `renew()` - Now validates current timestamp is within the renewal window before executing

### New Events
- `WindowUpdated { sub_id, billing_start, billing_end }` - Emitted when window is set/updated

### Validation
- Reverts with "Outside renewal window" if current timestamp is before `billing_start` or after `billing_end`
- Reverts with "Invalid window: start must be before end" if window is misconfigured

## Backend Changes

### Database
- Added `billing_start_timestamp` column to `subscriptions` table
- Added `billing_end_timestamp` column to `subscriptions` table

### Event Listener
- Handles `WindowUpdated` events → Updates billing timestamps in DB

## Usage Example

```rust
// Owner sets renewal window (Unix timestamps)
let start = 1704067200; // Jan 1, 2024 00:00:00 UTC
let end = 1704153600;   // Jan 2, 2024 00:00:00 UTC
contract.set_window(env, sub_id, start, end);

// Renewal only succeeds within window
contract.renew(env, caller, sub_id, approval_id, amount, max_retries, cooldown, true);
// ✅ Success if current time is between start and end
// ❌ Reverts if outside window
```

## Security
- Only owner can set/update renewal window
- Window validation happens before approval consumption
- Prevents premature or delayed renewals
