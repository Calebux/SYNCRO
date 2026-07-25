#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, xdr::ToXdr, Address, Bytes, Env, IntoVal,
};

/// Storage keys for contract-level state (admin, pause flag).
#[contracttype]
#[derive(Clone)]
enum ContractKey {
    Admin,
    Paused,
    LoggingContract,
}

/// Storage key for approvals: (sub_id, approval_id)
#[contracttype]
#[derive(Clone)]
struct ApprovalKey {
    sub_id: u64,
    approval_id: u64,
}

/// Storage key for cycle-level deduplication per subscription
#[contracttype]
#[derive(Clone)]
struct CycleKey {
    sub_id: u64,
}

/// Storage key for renewal processing lock
#[contracttype]
#[derive(Clone)]
struct RenewalLockKey {
    lock_sub_id: u64,
}

/// Storage key for lifecycle timestamps per subscription
#[contracttype]
#[derive(Clone)]
struct LifecycleKey {
    lifecycle_sub_id: u64,
}

/// Data stored for an active renewal lock
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalLockData {
    pub locked_at: u32,
    pub lock_timeout: u32,
}

/// Renewal approval bound to subscription, amount, and expiration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalApproval {
    pub sub_id: u64,
    pub max_spend: i128,
    pub expires_at: u32,
    pub used: bool,
}

/// Represents the current state of a subscription
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubscriptionState {
    Active,
    Retrying,
    Failed,
    Cancelled,
}

/// Core subscription data stored on-chain
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionData {
    pub owner: Address,
    pub merchant: Address,
    pub amount: i128,
    pub frequency: u64,
    pub spending_cap: i128,
    pub integrity_hash: soroban_sdk::BytesN<32>,
    pub state: SubscriptionState,
    pub failure_count: u32,
    pub last_attempt_ledger: u32,
}

/// Immutable audit timestamps for subscription lifecycle events.
/// All timestamps are Unix epoch seconds from env.ledger().timestamp().
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LifecycleTimestamps {
    pub created_at: u64,
    pub activated_at: u64,
    pub last_renewed_at: u64,
    pub canceled_at: u64,
}

/// Events for subscription renewal tracking
#[contractevent]
pub struct RenewalSuccess {
    pub sub_id: u64,
    pub owner: Address,
}

#[contractevent]
pub struct RenewalFailed {
    pub sub_id: u64,
    pub failure_count: u32,
    pub ledger: u32,
}

#[contractevent]
pub struct StateTransition {
    pub sub_id: u64,
    pub new_state: SubscriptionState,
}

#[contractevent]
pub struct PauseToggled {
    pub paused: bool,
}

#[contractevent]
pub struct ApprovalCreated {
    pub sub_id: u64,
    pub approval_id: u64,
    pub max_spend: i128,
    pub expires_at: u32,
}

#[contractevent]
pub struct ApprovalRejected {
    pub sub_id: u64,
    pub approval_id: u64,
    pub reason: u32, // 1=expired, 2=used, 3=amount_exceeded, 4=not_found
}

#[contractevent]
pub struct DuplicateRenewalRejected {
    pub sub_id: u64,
    pub cycle_id: u64,
}

#[contractevent]
pub struct IntegrityViolation {
    pub sub_id: u64,
}

#[contractevent]
pub struct RenewalLockAcquired {
    pub sub_id: u64,
    pub locked_at: u32,
    pub lock_timeout: u32,
}

#[contractevent]
pub struct RenewalLockReleased {
    pub sub_id: u64,
    pub released_at: u32,
}

#[contractevent]
pub struct RenewalLockExpired {
    pub sub_id: u64,
    pub original_locked_at: u32,
    pub expired_at: u32,
}

#[contractevent]
pub struct LifecycleTimestampUpdated {
    pub sub_id: u64,
    pub event_kind: u32, // 1=created, 2=activated, 3=renewed, 4=canceled
    pub timestamp: u64,
}

#[contractevent]
pub struct WindowUpdated {
    pub sub_id: u64,
    pub billing_start: u64,
    pub billing_end: u64,
}

#[contractevent]
pub struct SpendingCapViolated {
    pub sub_id: u64,
    pub amount: i128,
    pub cap: i128,
}

#[contractevent]
pub struct GlobalCapViolated {
    pub owner: Address,
    pub amount: i128,
    pub cap: i128,
}

#[contractevent]
pub struct UserCapUpdated {
    pub user: Address,
    pub cap: i128,
}

/// Storage key for renewal window per subscription
#[contracttype]
#[derive(Clone)]
struct WindowKey {
    sub_id: u64,
}

/// Billing window for a subscription renewal
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalWindow {
    pub billing_start: u64,
    pub billing_end: u64,
}

/// Storage key for global user spending caps
#[contracttype]
#[derive(Clone)]
pub enum UserCapKey {
    UserCap(Address),
    UserSpent(Address),
}

#[contract]
pub struct SubscriptionRenewalContract;

#[contractimpl]
impl SubscriptionRenewalContract {
    // ── Admin / Pause management ──────────────────────────────────

    /// Initialize the contract admin. Can only be called once.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&ContractKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&ContractKey::Admin, &admin);
        env.storage().instance().set(&ContractKey::Paused, &false);
    }

    /// Internal helper – loads admin and calls `require_auth`.
    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ContractKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();
    }

    /// Pause or unpause all renewal execution. Admin only.
    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&ContractKey::Paused, &paused);
        PauseToggled { paused }.publish(&env);
    }

    /// Query the current pause state.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&ContractKey::Paused)
            .unwrap_or(false)
    }

    /// Set the logging contract address. Admin only.
    pub fn set_logging_contract(env: Env, address: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&ContractKey::LoggingContract, &address);
    }

    // ── Renewal lock management ────────────────────────────────────

    /// Acquire a processing lock for a subscription renewal.
    /// Prevents concurrent renewal execution by multiple workers.
    pub fn acquire_renewal_lock(env: Env, sub_id: u64, lock_timeout: u32) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        let lock_key = RenewalLockKey {
            lock_sub_id: sub_id,
        };
        let current_ledger = env.ledger().sequence();

        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<RenewalLockKey, RenewalLockData>(&lock_key)
        {
            // Check if existing lock has expired
            if current_ledger < existing.locked_at + existing.lock_timeout {
                panic!("Renewal lock active");
            }
            // Lock expired — emit expiry event and allow re-acquisition
            RenewalLockExpired {
                sub_id,
                original_locked_at: existing.locked_at,
                expired_at: current_ledger,
            }
            .publish(&env);
        }

        let lock_data = RenewalLockData {
            locked_at: current_ledger,
            lock_timeout,
        };
        env.storage().persistent().set(&lock_key, &lock_data);

        RenewalLockAcquired {
            sub_id,
            locked_at: current_ledger,
            lock_timeout,
        }
        .publish(&env);
    }

    /// Release a processing lock for a subscription renewal.
    pub fn release_renewal_lock(env: Env, sub_id: u64) {
        let lock_key = RenewalLockKey {
            lock_sub_id: sub_id,
        };
        if !env.storage().persistent().has(&lock_key) {
            panic!("No renewal lock to release");
        }

        let current_ledger = env.ledger().sequence();
        env.storage().persistent().remove(&lock_key);

        RenewalLockReleased {
            sub_id,
            released_at: current_ledger,
        }
        .publish(&env);
    }

    /// Query the current renewal lock for a subscription.
    pub fn get_renewal_lock(env: Env, sub_id: u64) -> Option<RenewalLockData> {
        let lock_key = RenewalLockKey {
            lock_sub_id: sub_id,
        };
        env.storage().persistent().get(&lock_key)
    }

    // ── Subscription logic ────────────────────────────────────────

    /// Initialize a subscription
    pub fn init_sub(
        env: Env,
        owner: Address,
        merchant: Address,
        amount: i128,
        frequency: u64,
        spending_cap: i128,
        sub_id: u64,
    ) {
        let mut integrity_data = soroban_sdk::Vec::<soroban_sdk::Val>::new(&env);
        integrity_data.push_back(merchant.into_val(&env));
        integrity_data.push_back(amount.into_val(&env));
        integrity_data.push_back(frequency.into_val(&env));
        integrity_data.push_back(spending_cap.into_val(&env));

        // Use a simple hash of the vector of values
        let integrity_hash = env.crypto().sha256(&integrity_data.to_xdr(&env));

        let key = sub_id;
        let data = SubscriptionData {
            owner,
            merchant,
            amount,
            frequency,
            spending_cap,
            integrity_hash: integrity_hash.into(),
            state: SubscriptionState::Active,
            failure_count: 0,
            last_attempt_ledger: 0,
        };
        env.storage().persistent().set(&key, &data);

        // Initialize lifecycle timestamps
        let now = env.ledger().timestamp();
        let lifecycle = LifecycleTimestamps {
            created_at: now,
            activated_at: now,
            last_renewed_at: 0,
            canceled_at: 0,
        };
        let lc_key = LifecycleKey {
            lifecycle_sub_id: sub_id,
        };
        env.storage().persistent().set(&lc_key, &lifecycle);

        LifecycleTimestampUpdated {
            sub_id,
            event_kind: 1,
            timestamp: now,
        }
        .publish(&env);
        LifecycleTimestampUpdated {
            sub_id,
            event_kind: 2,
            timestamp: now,
        }
        .publish(&env);

        // Record initialization log
        Self::record_log(
            &env,
            sub_id,
            2,
            soroban_sdk::String::from_str(&env, "Subscription initialized"),
        );
    }

    fn record_log(env: &Env, sub_id: u64, event_type: u32, data_str: soroban_sdk::String) {
        if let Some(_log_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&ContractKey::LoggingContract)
        {
            // Here we would call the logging contract.
            // Since we are in a multi-contract setup, we'd use a client.
            // For now, we'll emit an event as a placeholder or assume the client is available.
            // (In a real implementation, we'd use a cross-contract call).
            env.events().publish(
                (soroban_sdk::symbol_short!("log"), sub_id),
                (event_type, data_str),
            );
        }
    }

    /// Explicitly cancel a subscription
    pub fn cancel_sub(env: Env, sub_id: u64) {
        let key = sub_id;
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Subscription not found");

        data.owner.require_auth();

        if data.state == SubscriptionState::Cancelled {
            panic!("Subscription already cancelled");
        }

        data.state = SubscriptionState::Cancelled;
        env.storage().persistent().set(&key, &data);

        // Update lifecycle timestamps
        let lc_key = LifecycleKey {
            lifecycle_sub_id: sub_id,
        };
        let mut lifecycle: LifecycleTimestamps = env
            .storage()
            .persistent()
            .get(&lc_key)
            .expect("Lifecycle data not found");
        let now = env.ledger().timestamp();
        lifecycle.canceled_at = now;
        env.storage().persistent().set(&lc_key, &lifecycle);

        LifecycleTimestampUpdated {
            sub_id,
            event_kind: 4,
            timestamp: now,
        }
        .publish(&env);

        // Record cancellation log
        Self::record_log(
            &env,
            sub_id,
            5,
            soroban_sdk::String::from_str(&env, "Subscription cancelled"),
        );

        // Emit state transition event
        StateTransition {
            sub_id,
            new_state: SubscriptionState::Cancelled,
        }
        .publish(&env);
    }

    // ── Approval management ───────────────────────────────────────

    /// Create a renewal approval for a subscription
    pub fn approve_renewal(
        env: Env,
        sub_id: u64,
        approval_id: u64,
        max_spend: i128,
        expires_at: u32,
    ) {
        let sub_key = sub_id;
        let data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&sub_key)
            .expect("Subscription not found");

        data.owner.require_auth();

        let approval = RenewalApproval {
            sub_id,
            max_spend,
            expires_at,
            used: false,
        };

        let key = ApprovalKey {
            sub_id,
            approval_id,
        };
        env.storage().persistent().set(&key, &approval);

        ApprovalCreated {
            sub_id,
            approval_id,
            max_spend,
            expires_at,
        }
        .publish(&env);
    }

    /// Validate and consume an approval
    fn consume_approval(env: &Env, sub_id: u64, approval_id: u64, amount: i128) -> bool {
        let key = ApprovalKey {
            sub_id,
            approval_id,
        };

        let approval_opt: Option<RenewalApproval> = env.storage().persistent().get(&key);

        if approval_opt.is_none() {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 4,
            }
            .publish(env);
            return false;
        }

        let mut approval = approval_opt.unwrap();

        if approval.used {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 2,
            }
            .publish(env);
            return false;
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger > approval.expires_at {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 1,
            }
            .publish(env);
            return false;
        }

        if amount > approval.max_spend {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 3,
            }
            .publish(env);
            return false;
        }

        approval.used = true;
        env.storage().persistent().set(&key, &approval);
        true
    }

    // ── Renewal logic ─────────────────────────────────────────────

    /// Attempt to renew the subscription.
    /// Returns true if renewal is successful (simulated), false if it failed and retry logic was triggered.
    /// limits: max retries allowed.
    /// cooldown: min ledgers between retries.
    pub fn renew(
        env: Env,
        sub_id: u64,
        approval_id: u64,
        amount: i128,
        max_retries: u32,
        cooldown_ledgers: u32,
        cycle_id: u64,
        succeed: bool,
    ) -> bool {
        // 1. Check global pause
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        // Get current ledger early (needed for lock verification)
        let current_ledger = env.ledger().sequence();

        // 2. Load subscription data
        let key = sub_id;
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Subscription not found");

        // 3. Check failed state
        if data.state == SubscriptionState::Failed {
            panic!("Subscription is in FAILED state");
        }

        // 4. Verify renewal lock exists and is not expired
        let lock_key = RenewalLockKey {
            lock_sub_id: sub_id,
        };
        let lock_data: Option<RenewalLockData> = env.storage().persistent().get(&lock_key);
        match lock_data {
            None => panic!("Renewal lock required"),
            Some(ref ld) => {
                if current_ledger >= ld.locked_at + ld.lock_timeout {
                    panic!("Renewal lock expired");
                }
            }
        }

        // 5. Cycle guard: reject duplicate renewal for the same billing cycle
        let cycle_key = CycleKey { sub_id };
        let last_cycle: Option<u64> = env.storage().persistent().get(&cycle_key);
        if let Some(last) = last_cycle {
            if cycle_id == last {
                DuplicateRenewalRejected { sub_id, cycle_id }.publish(&env);
                panic!("Duplicate renewal for cycle");
            }
        }

        // 6. Check cooldown
        if data.failure_count > 0 && current_ledger < data.last_attempt_ledger + cooldown_ledgers {
            panic!("Cooldown period active");
        }

        // 7. Validate and consume approval (also checks renewal window if set)
        if !Self::consume_approval(&env, sub_id, approval_id, amount) {
            panic!("Invalid or expired approval");
        }

        // 7b. Enforce renewal window if configured
        let window_key = WindowKey { sub_id };
        if let Some(window) = env.storage().persistent().get::<WindowKey, RenewalWindow>(&window_key) {
            let current_time = env.ledger().timestamp();
            if current_time < window.billing_start || current_time > window.billing_end {
                panic!("Outside renewal window");
            }
        }

        // 8. Validate Integrity Hash
        let mut integrity_data = soroban_sdk::Vec::<soroban_sdk::Val>::new(&env);
        integrity_data.push_back(data.merchant.into_val(&env));
        integrity_data.push_back(data.amount.into_val(&env));
        integrity_data.push_back(data.frequency.into_val(&env));
        integrity_data.push_back(data.spending_cap.into_val(&env));

        let current_hash = env.crypto().sha256(&integrity_data.to_xdr(&env));
        let current_hash_bytes: soroban_sdk::BytesN<32> = current_hash.into();

        if current_hash_bytes.as_ref() != data.integrity_hash.as_ref() {
            IntegrityViolation { sub_id }.publish(&env);
            panic!("Subscription integrity violation: parameters tampered");
        }

        // 9. Enforce per-subscription spending cap
        if data.spending_cap > 0 && amount > data.spending_cap {
            SpendingCapViolated {
                sub_id,
                amount,
                cap: data.spending_cap,
            }
            .publish(&env);
            panic!("Per-subscription spending cap exceeded");
        }

        // 10. Enforce global user spending cap
        let global_cap: i128 = env
            .storage()
            .persistent()
            .get(&UserCapKey::UserCap(data.owner.clone()))
            .unwrap_or(0);
        if global_cap > 0 {
            let current_spent: i128 = env
                .storage()
                .persistent()
                .get(&UserCapKey::UserSpent(data.owner.clone()))
                .unwrap_or(0);
            if current_spent + amount > global_cap {
                GlobalCapViolated {
                    owner: data.owner.clone(),
                    amount: current_spent + amount,
                    cap: global_cap,
                }
                .publish(&env);
                panic!("Global user spending cap exceeded");
            }
        }

        if succeed {
            // Capture previous state before changing it
            let previous_state = data.state;

            // Simulated success - renewal successful
            data.state = SubscriptionState::Active;
            data.failure_count = 0;
            data.last_attempt_ledger = current_ledger;
            env.storage().persistent().set(&key, &data);

            // Update global user spent amount
            let current_spent: i128 = env
                .storage()
                .persistent()
                .get(&UserCapKey::UserSpent(data.owner.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&UserCapKey::UserSpent(data.owner.clone()), &(current_spent + amount));

            // Store cycle_id on success only
            env.storage().persistent().set(&cycle_key, &cycle_id);

            // Emit renewal success event
            RenewalSuccess {
                sub_id,
                owner: data.owner.clone(),
            }
            .publish(&env);

            // Update lifecycle timestamps
            let lc_key = LifecycleKey {
                lifecycle_sub_id: sub_id,
            };
            let mut lifecycle: LifecycleTimestamps = env
                .storage()
                .persistent()
                .get(&lc_key)
                .expect("Lifecycle data not found");
            let now = env.ledger().timestamp();
            lifecycle.last_renewed_at = now;

            LifecycleTimestampUpdated {
                sub_id,
                event_kind: 3,
                timestamp: now,
            }
            .publish(&env);

            // If recovering from Retrying, also update activated_at
            if previous_state == SubscriptionState::Retrying {
                lifecycle.activated_at = now;
                LifecycleTimestampUpdated {
                    sub_id,
                    event_kind: 2,
                    timestamp: now,
                }
                .publish(&env);
            }
            env.storage().persistent().set(&lc_key, &lifecycle);

            // Auto-release lock
            env.storage().persistent().remove(&lock_key);
            RenewalLockReleased {
                sub_id,
                released_at: current_ledger,
            }
            .publish(&env);

            // Record renewal success log
            Self::record_log(
                &env,
                sub_id,
                2,
                soroban_sdk::String::from_str(&env, "Renewal successful"),
            );

            true
        } else {
            // Simulated failure - renewal failed, apply retry logic
            // Do NOT store cycle_id on failure — retries with same cycle_id remain allowed
            data.failure_count += 1;
            data.last_attempt_ledger = current_ledger;

            // Emit renewal failure event
            RenewalFailed {
                sub_id,
                failure_count: data.failure_count,
                ledger: current_ledger,
            }
            .publish(&env);

            // Determine new state based on retry count
            if data.failure_count > max_retries {
                data.state = SubscriptionState::Failed;
                StateTransition {
                    sub_id,
                    new_state: SubscriptionState::Failed,
                }
                .publish(&env);

                // Record failure log
                Self::record_log(
                    &env,
                    sub_id,
                    3,
                    soroban_sdk::String::from_str(&env, "Renewal failed - max retries exceeded"),
                );
            } else {
                data.state = SubscriptionState::Retrying;
                StateTransition {
                    sub_id,
                    new_state: SubscriptionState::Retrying,
                }
                .publish(&env);

                // Record retry log
                Self::record_log(
                    &env,
                    sub_id,
                    4,
                    soroban_sdk::String::from_str(&env, "Renewal failed - scheduled for retry"),
                );
            }

            env.storage().persistent().set(&key, &data);

            // Auto-release lock
            env.storage().persistent().remove(&lock_key);
            RenewalLockReleased {
                sub_id,
                released_at: current_ledger,
            }
            .publish(&env);

            false
        }
    }

    pub fn get_sub(env: Env, sub_id: u64) -> SubscriptionData {
        env.storage()
            .persistent()
            .get(&sub_id)
            .expect("Subscription not found")
    }

    pub fn get_lifecycle(env: Env, sub_id: u64) -> LifecycleTimestamps {
        let lc_key = LifecycleKey {
            lifecycle_sub_id: sub_id,
        };
        env.storage()
            .persistent()
            .get(&lc_key)
            .expect("Lifecycle data not found")
    }

    /// Set a billing window for a subscription. Admin only.
    pub fn set_window(env: Env, sub_id: u64, billing_start: u64, billing_end: u64) {
        Self::require_admin(&env);
        if billing_start >= billing_end {
            panic!("Invalid window: start must be before end");
        }
        let key = WindowKey { sub_id };
        let window = RenewalWindow {
            billing_start,
            billing_end,
        };
        env.storage().persistent().set(&key, &window);
        WindowUpdated {
            sub_id,
            billing_start,
            billing_end,
        }
        .publish(&env);
    }

    /// Get the billing window for a subscription.
    pub fn get_window(env: Env, sub_id: u64) -> Option<RenewalWindow> {
        let key = WindowKey { sub_id };
        env.storage().persistent().get(&key)
    }

    /// Set global spending cap for a user. Admin only.
    pub fn set_user_cap(env: Env, user: Address, cap: i128) {
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .set(&UserCapKey::UserCap(user.clone()), &cap);
        UserCapUpdated { user, cap }.publish(&env);
    }

    /// Get global spending cap for a user.
    pub fn get_user_cap(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&UserCapKey::UserCap(user))
            .unwrap_or(0)
    }

    /// Get current global spent amount for a user.
    pub fn get_user_spent(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&UserCapKey::UserSpent(user))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz;
