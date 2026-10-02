# Delegated Execution Feature

## Overview
Users can now assign another address to execute renewals without transferring ownership.

## Contract Changes

### New Storage
- `ExecutorKey` - Storage key for executor addresses per subscription

### New Functions
- `set_executor(sub_id, executor)` - Assign executor (owner only)
- `remove_executor(sub_id)` - Remove executor (owner only)
- `get_executor(sub_id)` - Query current executor

### Updated Functions
- `renew()` - Now accepts `caller` parameter and verifies caller is owner OR executor

### New Events
- `ExecutorAssigned { sub_id, executor }` - Emitted when executor is assigned
- `ExecutorRemoved { sub_id }` - Emitted when executor is removed

## Backend Changes

### Database
- Added `executor_address` column to `subscriptions` table

### Event Listener
- Handles `ExecutorAssigned` events → Updates `executor_address` in DB
- Handles `ExecutorRemoved` events → Clears `executor_address` in DB

## Usage Example

```rust
// Owner assigns executor
contract.set_executor(env, sub_id, executor_address);

// Executor can now call renew
contract.renew(env, executor_address, sub_id, approval_id, amount, max_retries, cooldown, true);

// Owner can remove executor
contract.remove_executor(env, sub_id);
```

## Security
- Only owner can assign/remove executors
- Executor cannot transfer ownership
- Executor can only execute renewals (with valid approvals)
- Owner retains full control
