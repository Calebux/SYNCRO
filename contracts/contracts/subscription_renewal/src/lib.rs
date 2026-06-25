#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype,
    Address, Bytes, BytesN, Env,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum ContractKey {
    Admin,
    Paused,
    LoggingContract,
    FeeConfig,
}

#[contracttype]
#[derive(Clone)]
struct ApprovalKey {
    sub_id: u64,
    approval_id: u64,
}

/// Stores the optional stealth address registered with an approval.
#[contracttype]
#[derive(Clone)]
struct StealthApprovalKey {
    sub_id: u64,
    approval_id: u64,
}

#[contracttype]
#[derive(Clone)]
struct ExecutorKey {
    sub_id: u64,
}

#[contracttype]
#[derive(Clone)]
struct WindowKey {
    sub_id: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum UserCapKey {
    UserCap(Address),
    UserSpent(Address),
}

#[contracttype]
#[derive(Clone)]
struct RenewalLockKey {
    lock_sub_id: u64,
}

#[contracttype]
#[derive(Clone)]
struct CycleKey {
    sub_id: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LastCycle {
    pub cycle_id: u64,
}

#[contracttype]
#[derive(Clone)]
struct LifecycleKey {
    lifecycle_sub_id: u64,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalApproval {
    pub sub_id: u64,
    pub max_spend: i128,
    pub expires_at: u32,
    pub used: u32,  // 0 = unused, 1 = used
}

// Stealth auth uses flat Option<BytesN<32>> + Option<BytesN<64>> params in renew().

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubscriptionState {
    Active,
    Retrying,
    Failed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionData {
    pub owner: Address,
    pub merchant: Address,
    pub amount: i128,
    pub frequency: u64,
    pub spending_cap: i128,
    pub integrity_hash: BytesN<32>,
    pub state: SubscriptionState,
    pub failure_count: u32,
    pub last_attempt_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LifecycleTimestamps {
    pub created_at: u64,
    pub activated_at: u64,
    pub last_renewed_at: u64,
    pub canceled_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalWindow {
    pub billing_start: u64,
    pub billing_end: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalLockData {
    pub locked_at: u32,
    pub lock_timeout: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub percentage: u32,
    pub recipient: Address,
}

// ── Events ────────────────────────────────────────────────────────────────────

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
    pub reason: u32,
}

#[contractevent]
pub struct ExecutorAssigned {
    pub sub_id: u64,
    pub executor: Address,
}

#[contractevent]
pub struct ExecutorRemoved {
    pub sub_id: u64,
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
    pub event_kind: u32,
    pub timestamp: u64,
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
pub struct LogEmitted {
    pub sub_id: u64,
    pub event_type: u32,
}

#[contractevent]
pub struct FeeConfigUpdated {
    pub percentage: u32,
    pub recipient: Address,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct SubscriptionRenewalContract;

#[contractimpl]
impl SubscriptionRenewalContract {
    // ── Admin / Pause ─────────────────────────────────────────────

    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&ContractKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&ContractKey::Admin, &admin);
        env.storage().instance().set(&ContractKey::Paused, &false);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ContractKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&ContractKey::Paused, &paused);
        PauseToggled { paused }.publish(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&ContractKey::Paused)
            .unwrap_or(false)
    }

    pub fn set_fee_config(env: Env, percentage: u32, recipient: Address) {
        Self::require_admin(&env);
        if percentage > 10000 {
            panic!("Fee percentage exceeds 100%");
        }
        let config = FeeConfig { percentage, recipient: recipient.clone() };
        env.storage().instance().set(&ContractKey::FeeConfig, &config);
        FeeConfigUpdated { percentage, recipient }.publish(&env);
    }

    pub fn get_fee_config(env: Env) -> Option<FeeConfig> {
        env.storage().instance().get(&ContractKey::FeeConfig)
    }

    pub fn set_logging_contract(env: Env, address: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&ContractKey::LoggingContract, &address);
    }

    // ── User caps ─────────────────────────────────────────────────

    pub fn set_user_cap(env: Env, user: Address, cap: i128) {
        Self::require_admin(&env);
        env.storage().persistent().set(&UserCapKey::UserCap(user.clone()), &cap);
        UserCapUpdated { user, cap }.publish(&env);
    }

    pub fn get_user_cap(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&UserCapKey::UserCap(user)).unwrap_or(0)
    }

    pub fn get_user_spent(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&UserCapKey::UserSpent(user)).unwrap_or(0)
    }

    // ── Subscription management ───────────────────────────────────

    pub fn init_sub(
        env: Env,
        owner: Address,
        merchant: Address,
        amount: i128,
        frequency: u64,
        spending_cap: i128,
        sub_id: u64,
    ) {
        // Integrity hash placeholder — full computation deferred to Issue #35.
        let integrity_hash: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);

        let data = SubscriptionData {
            owner,
            merchant,
            amount,
            frequency,
            spending_cap,
            integrity_hash,
            state: SubscriptionState::Active,
            failure_count: 0,
            last_attempt_ledger: 0,
        };
        env.storage().persistent().set(&sub_id, &data);

        let now = env.ledger().timestamp();
        let lifecycle = LifecycleTimestamps {
            created_at: now,
            activated_at: now,
            last_renewed_at: 0,
            canceled_at: 0,
        };
        let lc_key = LifecycleKey { lifecycle_sub_id: sub_id };
        env.storage().persistent().set(&lc_key, &lifecycle);

        LifecycleTimestampUpdated { sub_id, event_kind: 1, timestamp: now }.publish(&env);
        LifecycleTimestampUpdated { sub_id, event_kind: 2, timestamp: now }.publish(&env);

        Self::record_log(&env, sub_id, 2, soroban_sdk::String::from_str(&env, "Subscription initialized"));
    }

    pub fn get_sub(env: Env, sub_id: u64) -> SubscriptionData {
        env.storage().persistent().get(&sub_id).expect("Subscription not found")
    }

    pub fn get_lifecycle(env: Env, sub_id: u64) -> LifecycleTimestamps {
        let lc_key = LifecycleKey { lifecycle_sub_id: sub_id };
        env.storage().persistent().get(&lc_key).expect("Lifecycle data not found")
    }

    pub fn cancel_sub(env: Env, sub_id: u64) {
        let mut data: SubscriptionData = env
            .storage().persistent().get(&sub_id).expect("Subscription not found");
        data.owner.require_auth();

        if data.state == SubscriptionState::Cancelled {
            panic!("Subscription already cancelled");
        }

        data.state = SubscriptionState::Cancelled;
        env.storage().persistent().set(&sub_id, &data);

        let lc_key = LifecycleKey { lifecycle_sub_id: sub_id };
        let mut lifecycle: LifecycleTimestamps = env
            .storage().persistent().get(&lc_key).expect("Lifecycle data not found");
        let now = env.ledger().timestamp();
        lifecycle.canceled_at = now;
        env.storage().persistent().set(&lc_key, &lifecycle);

        LifecycleTimestampUpdated { sub_id, event_kind: 4, timestamp: now }.publish(&env);
        StateTransition { sub_id, new_state: SubscriptionState::Cancelled }.publish(&env);
        Self::record_log(&env, sub_id, 5, soroban_sdk::String::from_str(&env, "Subscription cancelled"));
    }

    // ── Executor management ───────────────────────────────────────

    pub fn set_executor(env: Env, sub_id: u64, executor: Address) {
        let data: SubscriptionData = env
            .storage().persistent().get(&sub_id).expect("Subscription not found");
        data.owner.require_auth();
        let key = ExecutorKey { sub_id };
        env.storage().persistent().set(&key, &executor);
        ExecutorAssigned { sub_id, executor }.publish(&env);
    }

    pub fn remove_executor(env: Env, sub_id: u64) {
        let data: SubscriptionData = env
            .storage().persistent().get(&sub_id).expect("Subscription not found");
        data.owner.require_auth();
        let key = ExecutorKey { sub_id };
        env.storage().persistent().remove(&key);
        ExecutorRemoved { sub_id }.publish(&env);
    }

    pub fn get_executor(env: Env, sub_id: u64) -> Option<Address> {
        let key = ExecutorKey { sub_id };
        env.storage().persistent().get(&key)
    }

    // ── Renewal window management ─────────────────────────────────

    pub fn set_window(env: Env, sub_id: u64, billing_start: u64, billing_end: u64) {
        let data: SubscriptionData = env
            .storage().persistent().get(&sub_id).expect("Subscription not found");
        data.owner.require_auth();

        if billing_start >= billing_end {
            panic!("Invalid window: start must be before end");
        }

        let window = RenewalWindow { billing_start, billing_end };
        let key = WindowKey { sub_id };
        env.storage().persistent().set(&key, &window);
        WindowUpdated { sub_id, billing_start, billing_end }.publish(&env);
    }

    pub fn get_window(env: Env, sub_id: u64) -> Option<RenewalWindow> {
        let key = WindowKey { sub_id };
        env.storage().persistent().get(&key)
    }

    // ── Approval management ───────────────────────────────────────

    /// Create a renewal approval. If `stealth_address` is non-zero, the approval
    /// can be consumed by presenting a valid stealth proof instead of the
    /// owner's direct signature in `renew()`.
    pub fn approve_renewal(
        env: Env,
        sub_id: u64,
        approval_id: u64,
        max_spend: i128,
        expires_at: u32,
        stealth_address: BytesN<32>,
    ) {
        let data: SubscriptionData = env
            .storage().persistent().get(&sub_id).expect("Subscription not found");
        data.owner.require_auth();

        let approval = RenewalApproval { sub_id, max_spend, expires_at, used: 0 };
        let key = ApprovalKey { sub_id, approval_id };
        env.storage().persistent().set(&key, &approval);

        // Store stealth address if non-zero.
        let zero: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        if stealth_address != zero {
            let sk = StealthApprovalKey { sub_id, approval_id };
            env.storage().persistent().set(&sk, &stealth_address);
        }

        ApprovalCreated { sub_id, approval_id, max_spend, expires_at }.publish(&env);
    }

    fn consume_approval(env: &Env, sub_id: u64, approval_id: u64, amount: i128) -> bool {
        let key = ApprovalKey { sub_id, approval_id };
        let approval_opt: Option<RenewalApproval> = env.storage().persistent().get(&key);

        if approval_opt.is_none() {
            ApprovalRejected { sub_id, approval_id, reason: 4 }.publish(env);
            return false;
        }

        let mut approval = approval_opt.unwrap();

        if approval.used != 0 {
            ApprovalRejected { sub_id, approval_id, reason: 2 }.publish(env);
            return false;
        }

        if env.ledger().sequence() > approval.expires_at {
            ApprovalRejected { sub_id, approval_id, reason: 1 }.publish(env);
            return false;
        }

        if amount > approval.max_spend {
            ApprovalRejected { sub_id, approval_id, reason: 3 }.publish(env);
            return false;
        }

        approval.used = 1;
        env.storage().persistent().set(&key, &approval);
        true
    }

    // ── Renewal lock management ───────────────────────────────────

    pub fn acquire_renewal_lock(env: Env, sub_id: u64, lock_timeout: u32) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        let lock_key = RenewalLockKey { lock_sub_id: sub_id };
        let current_ledger = env.ledger().sequence();

        if let Some(existing) = env
            .storage().persistent()
            .get::<RenewalLockKey, RenewalLockData>(&lock_key)
        {
            if current_ledger < existing.locked_at + existing.lock_timeout {
                panic!("Renewal lock active");
            }
            RenewalLockExpired {
                sub_id,
                original_locked_at: existing.locked_at,
                expired_at: current_ledger,
            }.publish(&env);
        }

        let lock_data = RenewalLockData { locked_at: current_ledger, lock_timeout };
        env.storage().persistent().set(&lock_key, &lock_data);
        RenewalLockAcquired { sub_id, locked_at: current_ledger, lock_timeout }.publish(&env);
    }

    pub fn release_renewal_lock(env: Env, sub_id: u64) {
        let lock_key = RenewalLockKey { lock_sub_id: sub_id };
        if !env.storage().persistent().has(&lock_key) {
            panic!("No renewal lock to release");
        }
        let current_ledger = env.ledger().sequence();
        env.storage().persistent().remove(&lock_key);
        RenewalLockReleased { sub_id, released_at: current_ledger }.publish(&env);
    }

    pub fn get_renewal_lock(env: Env, sub_id: u64) -> Option<RenewalLockData> {
        let lock_key = RenewalLockKey { lock_sub_id: sub_id };
        env.storage().persistent().get(&lock_key)
    }

    // ── Renewal logic ─────────────────────────────────────────────

    /// Process a renewal. Pass `stealth_pubkey` + `stealth_sig` to authenticate
    /// via an ephemeral stealth address; use all-zeros BytesN for both to fall back to
    /// the owner / executor direct-address check.
    pub fn renew(
        env: Env,
        caller: Address,
        sub_id: u64,
        approval_id: u64,
        amount: i128,
        max_retries: u32,
        cooldown_ledgers: u32,
        cycle_id: u64,
        succeed: bool,
        stealth_pubkey: BytesN<32>,
        stealth_sig: BytesN<64>,
    ) -> bool {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        let mut data: SubscriptionData = env
            .storage().persistent().get(&sub_id).expect("Subscription not found");

        // ── Auth: stealth proof OR direct address ─────────────────
        let stealth_key = StealthApprovalKey { sub_id, approval_id };
        let zero_pubkey: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);

        if stealth_pubkey != zero_pubkey {
            // Stealth proof provided
            let registered: Option<BytesN<32>> = env.storage().persistent().get(&stealth_key);
            match registered {
                Some(expected) => {
                    if stealth_pubkey != expected {
                        panic!("Stealth pubkey mismatch");
                    }
                    let mut msg_bytes = [0u8; 16];
                    msg_bytes[..8].copy_from_slice(&sub_id.to_le_bytes());
                    msg_bytes[8..].copy_from_slice(&approval_id.to_le_bytes());
                    let msg = Bytes::from_array(&env, &msg_bytes);
                    env.crypto().ed25519_verify(&stealth_pubkey, &msg, &stealth_sig);
                }
                None => panic!("No stealth address registered for this approval"),
            }
        } else {
            // Direct address auth
            caller.require_auth();
            let executor_key = ExecutorKey { sub_id };
            let executor: Option<Address> = env.storage().persistent().get(&executor_key);
            if caller != data.owner && Some(caller.clone()) != executor {
                panic!("Unauthorized: caller must be owner or executor");
            }
        }

        if !Self::consume_approval(&env, sub_id, approval_id, amount) {
            panic!("Invalid or expired approval");
        }

        // Window check.
        let window_key = WindowKey { sub_id };
        if let Some(window) = env
            .storage().persistent()
            .get::<WindowKey, RenewalWindow>(&window_key)
        {
            let current_time = env.ledger().timestamp();
            if current_time < window.billing_start || current_time > window.billing_end {
                panic!("Outside renewal window");
            }
        }

        if data.state == SubscriptionState::Failed {
            panic!("Subscription is in FAILED state");
        }

        let current_ledger = env.ledger().sequence();

        // Verify renewal lock.
        let lock_key = RenewalLockKey { lock_sub_id: sub_id };
        match env.storage().persistent().get::<RenewalLockKey, RenewalLockData>(&lock_key) {
            None => panic!("Renewal lock required"),
            Some(ref ld) => {
                if current_ledger >= ld.locked_at + ld.lock_timeout {
                    panic!("Renewal lock expired");
                }
            }
        }

        // Cycle dedup.
        let cycle_key = CycleKey { sub_id };
        if let Some(last) = env.storage().persistent().get::<CycleKey, LastCycle>(&cycle_key) {
            if cycle_id == last.cycle_id {
                DuplicateRenewalRejected { sub_id, cycle_id }.publish(&env);
                panic!("Duplicate renewal for cycle");
            }
        }

        // Cooldown.
        if data.failure_count > 0 && current_ledger < data.last_attempt_ledger + cooldown_ledgers {
            panic!("Cooldown period active");
        }

        // Integrity check (full recomputation deferred to Issue #35).
        // Placeholder: always passes.

        // Per-subscription spending cap.
        if data.spending_cap > 0 && amount > data.spending_cap {
            SpendingCapViolated { sub_id, amount, cap: data.spending_cap }.publish(&env);
            panic!("Per-subscription spending cap exceeded");
        }

        // Global user spending cap.
        let global_cap: i128 = env
            .storage().persistent()
            .get(&UserCapKey::UserCap(data.owner.clone()))
            .unwrap_or(0);
        if global_cap > 0 {
            let current_spent: i128 = env
                .storage().persistent()
                .get(&UserCapKey::UserSpent(data.owner.clone()))
                .unwrap_or(0);
            if current_spent + amount > global_cap {
                GlobalCapViolated {
                    owner: data.owner.clone(),
                    amount: current_spent + amount,
                    cap: global_cap,
                }.publish(&env);
                panic!("Global user spending cap exceeded");
            }
        }

        if succeed {
            let previous_state = data.state;
            data.state = SubscriptionState::Active;
            data.failure_count = 0;
            data.last_attempt_ledger = current_ledger;
            env.storage().persistent().set(&sub_id, &data);
            env.storage().persistent().set(&cycle_key, &LastCycle { cycle_id });

            if global_cap > 0 {
                let current_spent: i128 = env
                    .storage().persistent()
                    .get(&UserCapKey::UserSpent(data.owner.clone()))
                    .unwrap_or(0);
                env.storage().persistent()
                    .set(&UserCapKey::UserSpent(data.owner.clone()), &(current_spent + amount));
            }

            RenewalSuccess { sub_id, owner: data.owner.clone() }.publish(&env);

            let lc_key = LifecycleKey { lifecycle_sub_id: sub_id };
            let mut lifecycle: LifecycleTimestamps = env
                .storage().persistent().get(&lc_key).expect("Lifecycle data not found");
            let now = env.ledger().timestamp();
            lifecycle.last_renewed_at = now;
            LifecycleTimestampUpdated { sub_id, event_kind: 3, timestamp: now }.publish(&env);

            if previous_state == SubscriptionState::Retrying {
                lifecycle.activated_at = now;
                LifecycleTimestampUpdated { sub_id, event_kind: 2, timestamp: now }.publish(&env);
            }
            env.storage().persistent().set(&lc_key, &lifecycle);

            env.storage().persistent().remove(&lock_key);
            RenewalLockReleased { sub_id, released_at: current_ledger }.publish(&env);
            Self::record_log(&env, sub_id, 2, soroban_sdk::String::from_str(&env, "Renewal successful"));
            true
        } else {
            data.failure_count += 1;
            data.last_attempt_ledger = current_ledger;

            RenewalFailed { sub_id, failure_count: data.failure_count, ledger: current_ledger }.publish(&env);

            if data.failure_count > max_retries {
                data.state = SubscriptionState::Failed;
                StateTransition { sub_id, new_state: SubscriptionState::Failed }.publish(&env);
                Self::record_log(&env, sub_id, 3, soroban_sdk::String::from_str(&env, "Renewal failed - max retries exceeded"));
            } else {
                data.state = SubscriptionState::Retrying;
                StateTransition { sub_id, new_state: SubscriptionState::Retrying }.publish(&env);
                Self::record_log(&env, sub_id, 4, soroban_sdk::String::from_str(&env, "Renewal failed - scheduled for retry"));
            }

            env.storage().persistent().set(&sub_id, &data);
            env.storage().persistent().remove(&lock_key);
            RenewalLockReleased { sub_id, released_at: current_ledger }.publish(&env);
            false
        }
    }

    // ── Internal helpers ──────────────────────────────────────────

    fn record_log(env: &Env, sub_id: u64, event_type: u32, _data_str: soroban_sdk::String) {
        if let Some(_) = env.storage().instance().get::<_, Address>(&ContractKey::LoggingContract) {
            LogEmitted { sub_id, event_type }.publish(env);
        }
    }
}

#[cfg(test)]
mod test;
