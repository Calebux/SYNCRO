#![no_std]
use soroban_sdk::{
       contract, contractevent, contractimpl, contracttype, token, xdr::ToXdr, Address, Bytes, Env,
       IntoVal,
   };
use subscription_logging::SubscriptionLoggingContractClient;

/// Storage keys for contract-level state (admin, pause flag).
#[contracttype]
#[derive(Clone)]
enum ContractKey {
       Admin,
       Paused,
       LoggingContract,
       TokenContract,
   }

/// Tagged persistent storage keys.
#[contracttype]
#[derive(Clone)]
enum PersistentKey {
    Subscription(u64),
    Approval(u64, u64),
    Cycle(u64),
    RenewalLock(u64),
    Lifecycle(u64),
    Window(u64),
    UserCap(Address),
    UserSpent(Address),
    MultiSig(u64, u64),
    TeamThreshold(u64),
    SigningWindow(u64),
       /// Escrowed balance awaiting merchant claim, keyed by subscription id.
    EscrowBalance(u64),
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

/// Off-chain-indexing events for the subscription lifecycle. These follow the
   /// two-part (family, action) topic convention documented in
   /// docs/contract-event-schema.md, joining "subscription" as a canonical family
   /// alongside "escrow", "channel", etc.
   #[contractevent]
   pub struct SubscriptionCreated {
       pub sub_id: u64,
       pub owner: Address,
       pub merchant: Address,
       pub amount: i128,
       pub frequency: u64,
   }

   #[contractevent]
   pub struct SubscriptionRenewed {
       pub sub_id: u64,
       pub owner: Address,
       pub merchant: Address,
       pub amount: i128,
   }

   #[contractevent]
   pub struct SubscriptionCanceled {
       pub sub_id: u64,
       pub owner: Address,
   }

#[contractevent]
   pub struct EscrowLocked {
       pub sub_id: u64,
       pub merchant: Address,
       pub amount: i128,
       pub total_escrowed: i128,
   }

   #[contractevent]
   pub struct EscrowClaimed {
       pub sub_id: u64,
       pub merchant: Address,
       pub amount: i128,
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

/// Billing window for a subscription renewal
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewalWindow {
    pub billing_start: u64,
    pub billing_end: u64,
}

/// Status of a multi-sig approval request
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MultiSigStatus {
    Pending = 0,
    Approved = 1,
    Cancelled = 2,
    Expired = 3,
}

/// On-chain multi-sig approval request
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiSigRequest {
    pub sub_id: u64,
    pub request_id: u64,
    pub team_id: u64,
    pub amount: i128,
    pub requester: Address,
    pub required_signers: soroban_sdk::Vec<Address>,
    pub collected_signers: soroban_sdk::Vec<Address>,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: MultiSigStatus,
}

// ── Multi-sig events ──────────────────────────────────────────────

#[contractevent]
pub struct MultiSigRequested {
    pub sub_id: u64,
    pub request_id: u64,
    pub team_id: u64,
    pub amount: i128,
    pub expires_at: u64,
}

#[contractevent]
pub struct MultiSigSigned {
    pub sub_id: u64,
    pub request_id: u64,
    pub signer: Address,
    pub signatures_collected: u32,
    pub signatures_required: u32,
}

#[contractevent]
pub struct MultiSigApproved {
    pub sub_id: u64,
    pub request_id: u64,
    pub team_id: u64,
}

#[contractevent]
pub struct MultiSigCancelled {
    pub sub_id: u64,
    pub request_id: u64,
    pub cancelled_by: Address,
}

#[contractevent]
pub struct MultiSigExpired {
    pub sub_id: u64,
    pub request_id: u64,
    pub expired_at: u64,
}

#[contractevent]
pub struct MultiSigAuditLog {
    pub sub_id: u64,
    pub request_id: u64,
    /// 1=requested, 2=signed, 3=approved, 4=cancelled, 5=expired
    pub decision: u32,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent]
pub struct TeamThresholdUpdated {
    pub team_id: u64,
    pub threshold: i128,
}

/// Default threshold: 10_000_000 stroops ($100 USD equivalent)
const DEFAULT_MULTISIG_THRESHOLD: i128 = 10_000_000;
/// Default signing window: 24 hours in seconds
const DEFAULT_SIGNING_WINDOW_SECS: u64 = 86_400;

/// Renewal lock timeout bounds (in ledger-sequence units)
/// Minimum: 1 ledger (must be positive)
const RENEWAL_LOCK_TIMEOUT_MIN: u32 = 1;
/// Maximum: conservative upper bound to avoid indefinite leases (e.g. 1 week in ledgers).
const RENEWAL_LOCK_TIMEOUT_MAX: u32 = 604_800; // ~1 week in seconds/ledgers depending on ledger cadence

#[contract]
pub struct SubscriptionRenewalContract;

#[derive(Debug, Clone, PartialEq)]
enum ValidateError {
    Paused,
    SubscriptionNotFound,
    FailedState,
}

#[derive(Debug, Clone, PartialEq)]
enum LockError {
    Required,
    Expired,
}

#[derive(Debug, Clone, PartialEq)]
enum AuthorizeError {
    DuplicateCycle,
    CooldownActive,
    ApprovalRejected,
    OutsideWindow,
    IntegrityViolation,
    SpendingCapViolated,
    GlobalCapViolated,
}

#[derive(Debug, Clone, PartialEq)]
enum RenewalError {
    Validate(ValidateError),
    Lock(LockError),
    Authorize(AuthorizeError),
}

impl From<ValidateError> for RenewalError {
    fn from(e: ValidateError) -> Self {
        RenewalError::Validate(e)
    }
}

impl From<LockError> for RenewalError {
    fn from(e: LockError) -> Self {
        RenewalError::Lock(e)
    }
}

impl From<AuthorizeError> for RenewalError {
    fn from(e: AuthorizeError) -> Self {
        RenewalError::Authorize(e)
    }
}

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
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&ContractKey::LoggingContract, &address);
    }

    /// Set the token (asset) contract used to move funds into/out of escrow. Admin only.
       pub fn set_token_contract(env: Env, address: Address) {
           if Self::is_paused(env.clone()) {
               panic!("Protocol is paused");
           }
           Self::require_admin(&env);
           env.storage()
               .instance()
               .set(&ContractKey::TokenContract, &address);
       }

       /// Query the configured token contract address, if any.
       pub fn get_token_contract(env: Env) -> Option<Address> {
           env.storage().instance().get(&ContractKey::TokenContract)
       }

    // ── Renewal lock management ────────────────────────────────────

    /// Acquire a processing lock for a subscription renewal.
    /// Prevents concurrent renewal execution by multiple workers.
    pub fn acquire_renewal_lock(env: Env, sub_id: u64, lock_timeout: u32) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        // Validate caller-supplied timeout is within allowed bounds.
        if lock_timeout < RENEWAL_LOCK_TIMEOUT_MIN || lock_timeout > RENEWAL_LOCK_TIMEOUT_MAX {
            panic!("lock_timeout out of allowed range");
        }

        let lock_key = PersistentKey::RenewalLock(sub_id);
        let current_ledger = env.ledger().sequence();

        // Use temporary storage with automatic expiry semantics instead of
        // persistent storage so a crashed holder does not block the subscription
        // indefinitely. Treat absence as unlocked.
        if let Some(existing) = env.storage().temporary().get::<PersistentKey, RenewalLockData>(&lock_key) {
            // Check if existing lock has expired — note that temporary storage
            // may expire entries automatically; still guard against active locks.
            if current_ledger < existing.locked_at + existing.lock_timeout {
                panic!("Renewal lock active");
            }
            // Lock expired — emit expiry event and continue to re-acquire.
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

        // Write into temporary storage so it disappears automatically after TTL.
        env.storage().temporary().set(&lock_key, &lock_data);

        RenewalLockAcquired {
            sub_id,
            locked_at: current_ledger,
            lock_timeout,
        }
        .publish(&env);
    }

    /// Release a processing lock for a subscription renewal.
    pub fn release_renewal_lock(env: Env, sub_id: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        let lock_key = PersistentKey::RenewalLock(sub_id);
        if !env.storage().temporary().has(&lock_key) {
            panic!("No renewal lock to release");
        }

        let current_ledger = env.ledger().sequence();
        env.storage().temporary().remove(&lock_key);

        RenewalLockReleased {
            sub_id,
            released_at: current_ledger,
        }
        .publish(&env);
    }

    /// Query the current renewal lock for a subscription.
    pub fn get_renewal_lock(env: Env, sub_id: u64) -> Option<RenewalLockData> {
        let lock_key = PersistentKey::RenewalLock(sub_id);
        env.storage().temporary().get(&lock_key)
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
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        owner.require_auth();

        let mut integrity_data = soroban_sdk::Vec::<soroban_sdk::Val>::new(&env);
        integrity_data.push_back(merchant.into_val(&env));
        integrity_data.push_back(amount.into_val(&env));
        integrity_data.push_back(frequency.into_val(&env));
        integrity_data.push_back(spending_cap.into_val(&env));

        // Use a simple hash of the vector of values
        let integrity_hash = env.crypto().sha256(&integrity_data.to_xdr(&env));

        let key = PersistentKey::Subscription(sub_id);
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
        let lc_key = PersistentKey::Lifecycle(sub_id);
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
        // Emit indexer-facing lifecycle event
       SubscriptionCreated {
           sub_id,
           owner: data.owner.clone(),
           merchant: data.merchant.clone(),
           amount: data.amount,
           frequency: data.frequency,
       }
       .publish(&env);
    }

    fn record_log(env: &Env, sub_id: u64, event_type: u32, data_str: soroban_sdk::String) {
        if let Some(log_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&ContractKey::LoggingContract)
        {
            let logging_client = SubscriptionLoggingContractClient::new(env, &log_addr);
            let payload: Bytes = (sub_id, event_type, data_str).to_xdr(env);
            let commitment_hash = soroban_sdk::BytesN::from_array(
                env,
                &env.crypto().sha256(&payload).to_array(),
            );
            logging_client.record_commitment(&commitment_hash);
        }
    }

    /// Explicitly cancel a subscription
    pub fn cancel_sub(env: Env, sub_id: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        let key = PersistentKey::Subscription(sub_id);
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
        let lc_key = PersistentKey::Lifecycle(sub_id);
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

        // Emit indexer-facing lifecycle event
       SubscriptionCanceled {
           sub_id,
           owner: data.owner.clone(),
       }
       .publish(&env);

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
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        let sub_key = PersistentKey::Subscription(sub_id);
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

        let key = PersistentKey::Approval(sub_id, approval_id);
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
    #[allow(dead_code)]
    /// Result of an approval consumption attempt.
    #[derive(Clone, Debug, PartialEq)]
    enum ApprovalConsumeResult {
        Ok,
        NotFound,
        AlreadyUsed,
        Expired,
        AmountExceeded,
    }

    fn consume_approval(env: &Env, sub_id: u64, approval_id: u64, amount: i128) -> ApprovalConsumeResult {
        let key = PersistentKey::Approval(sub_id, approval_id);

        let approval_opt: Option<RenewalApproval> = env.storage().persistent().get(&key);

        if approval_opt.is_none() {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 4,
            }
            .publish(env);
            return ApprovalConsumeResult::NotFound;
        }

        let mut approval = approval_opt.unwrap();

        if approval.used {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 2,
            }
            .publish(env);
            return ApprovalConsumeResult::AlreadyUsed;
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger > approval.expires_at {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 1,
            }
            .publish(env);
            return ApprovalConsumeResult::Expired;
        }

        if amount > approval.max_spend {
            ApprovalRejected {
                sub_id,
                approval_id,
                reason: 3,
            }
            .publish(env);
            return ApprovalConsumeResult::AmountExceeded;
        }

        // Mark as used for now (single-use semantics). In later refactors this
        // should be performed only after transfer success, or be reversible.
        approval.used = true;
        env.storage().persistent().set(&key, &approval);
        ApprovalConsumeResult::Ok
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
        match Self::renew_internal(
            &env,
            sub_id,
            approval_id,
            amount,
            max_retries,
            cooldown_ledgers,
            cycle_id,
            succeed,
        ) {
            Ok(result) => result,
            Err(error) => Self::panic_with_error(error),
        }
    }

    fn renew_internal(
        env: &Env,
        sub_id: u64,
        approval_id: u64,
        amount: i128,
        max_retries: u32,
        cooldown_ledgers: u32,
        cycle_id: u64,
        succeed: bool,
    ) -> Result<bool, RenewalError> {
        if Self::is_paused((*env).clone()) {
            Self::release_lock_on_error(env, sub_id);
            return Err(RenewalError::Validate(ValidateError::Paused));
        }

        let current_ledger = env.ledger().sequence();

        let mut data = match Self::validate_subscription(env, sub_id) {
            Ok(data) => data,
            Err(e) => {
                Self::release_lock_on_error(env, sub_id);
                return Err(e.into());
            }
        };

        if let Err(e) = Self::check_renewal_lock(env, sub_id, current_ledger) {
            Self::release_lock_on_error(env, sub_id);
            return Err(e.into());
        }

        if let Err(e) = Self::authorize_renewal(
            env,
            &data,
            sub_id,
            approval_id,
            amount,
            cycle_id,
            cooldown_ledgers,
            current_ledger,
        ) {
            Self::release_lock_on_error(env, sub_id);
            return Err(e.into());
        }

        if succeed {
            Self::apply_success(env, &mut data, sub_id, amount, cycle_id, current_ledger);
            // Historical event order requires the lock release before the final
            // indexer event, so Release is sequenced between Charge and Record.
            Self::drop_renewal_lock(env, sub_id, current_ledger);
            Self::record_success(env, &data, sub_id, amount);
            Ok(true)
        } else {
            Self::apply_failure(env, &mut data, sub_id, max_retries, current_ledger);
            Self::drop_renewal_lock(env, sub_id, current_ledger);
            Ok(false)
        }
    }

    fn validate_subscription(env: &Env, sub_id: u64) -> Result<SubscriptionData, ValidateError> {
        let key = PersistentKey::Subscription(sub_id);
        let data: SubscriptionData = match env.storage().persistent().get(&key) {
            Some(data) => data,
            None => return Err(ValidateError::SubscriptionNotFound),
        };
        if data.state == SubscriptionState::Failed {
            return Err(ValidateError::FailedState);
        }
        Ok(data)
    }

    fn check_renewal_lock(
        env: &Env,
        sub_id: u64,
        current_ledger: u32,
    ) -> Result<(), LockError> {
        let lock_key = PersistentKey::RenewalLock(sub_id);
        let lock_data: Option<RenewalLockData> = env.storage().persistent().get(&lock_key);
        match lock_data {
            None => Err(LockError::Required),
            Some(ld) if current_ledger >= ld.locked_at + ld.lock_timeout => Err(LockError::Expired),
            Some(_) => Ok(()),
        }
    }

    fn authorize_renewal(
        env: &Env,
        data: &SubscriptionData,
        sub_id: u64,
        approval_id: u64,
        amount: i128,
        cycle_id: u64,
        cooldown_ledgers: u32,
        current_ledger: u32,
    ) -> Result<(), AuthorizeError> {
        let cycle_key = PersistentKey::Cycle(sub_id);
        let last_cycle: Option<u64> = env.storage().persistent().get(&cycle_key);
        if let Some(last) = last_cycle {
            if cycle_id == last {
                DuplicateRenewalRejected { sub_id, cycle_id }.publish(env);
                return Err(AuthorizeError::DuplicateCycle);
            }
        }

        if data.failure_count > 0 && current_ledger < data.last_attempt_ledger + cooldown_ledgers {
            return Err(AuthorizeError::CooldownActive);
        }

        if Self::consume_approval(env, sub_id, approval_id, amount) != ApprovalConsumeResult::Ok {
            return Err(AuthorizeError::ApprovalRejected);
        }

        let window_key = PersistentKey::Window(sub_id);
        if let Some(window) = env
            .storage()
            .persistent()
            .get::<PersistentKey, RenewalWindow>(&window_key)
        {
            let current_time = env.ledger().timestamp();
            if current_time < window.billing_start || current_time > window.billing_end {
                return Err(AuthorizeError::OutsideWindow);
            }
        }

        let mut integrity_data = soroban_sdk::Vec::<soroban_sdk::Val>::new(env);
        integrity_data.push_back(data.merchant.clone().into_val(env));
        integrity_data.push_back(data.amount.into_val(env));
        integrity_data.push_back(data.frequency.into_val(env));
        integrity_data.push_back(data.spending_cap.into_val(env));

        let current_hash = env.crypto().sha256(&integrity_data.to_xdr(env));
        let current_hash_bytes: soroban_sdk::BytesN<32> = current_hash.into();

        if current_hash_bytes.as_ref() != data.integrity_hash.as_ref() {
            IntegrityViolation { sub_id }.publish(env);
            return Err(AuthorizeError::IntegrityViolation);
        }

        if data.spending_cap > 0 && amount > data.spending_cap {
            SpendingCapViolated {
                sub_id,
                amount,
                cap: data.spending_cap,
            }
            .publish(env);
            return Err(AuthorizeError::SpendingCapViolated);
        }

        let global_cap: i128 = env
            .storage()
            .persistent()
            .get(&PersistentKey::UserCap(data.owner.clone()))
            .unwrap_or(0);
        if global_cap > 0 {
            let current_spent: i128 = env
                .storage()
                .persistent()
                .get(&PersistentKey::UserSpent(data.owner.clone()))
                .unwrap_or(0);
            if current_spent + amount > global_cap {
                GlobalCapViolated {
                    owner: data.owner.clone(),
                    amount: current_spent + amount,
                    cap: global_cap,
                }
                .publish(env);
                return Err(AuthorizeError::GlobalCapViolated);
            }
        }

        Ok(())
    }

    fn apply_success(
        env: &Env,
        data: &mut SubscriptionData,
        sub_id: u64,
        amount: i128,
        cycle_id: u64,
        current_ledger: u32,
    ) {
        let key = PersistentKey::Subscription(sub_id);
        let previous_state = data.state;

        data.state = SubscriptionState::Active;
        data.failure_count = 0;
        data.last_attempt_ledger = current_ledger;
        env.storage().persistent().set(&key, &*data);

        let current_spent: i128 = env
            .storage()
            .persistent()
            .get(&PersistentKey::UserSpent(data.owner.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&PersistentKey::UserSpent(data.owner.clone()), &(current_spent + amount));

        env.storage().persistent().set(&PersistentKey::Cycle(sub_id), &cycle_id);

        RenewalSuccess {
            sub_id,
            owner: data.owner.clone(),
        }
        .publish(env);

        if let Some(token_addr) = Self::get_token_contract((*env).clone()) {
            let token_client = token::Client::new(env, &token_addr);
            token_client.transfer(&data.owner, &env.current_contract_address(), &amount);

            let escrow_key = PersistentKey::EscrowBalance(sub_id);
            let existing: i128 = env
                .storage()
                .persistent()
                .get(&escrow_key)
                .unwrap_or(0);
            let total_escrowed = existing + amount;
            env.storage().persistent().set(&escrow_key, &total_escrowed);

            EscrowLocked {
                sub_id,
                merchant: data.merchant.clone(),
                amount,
                total_escrowed,
            }
            .publish(env);
        }

        let lc_key = PersistentKey::Lifecycle(sub_id);
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
        .publish(env);

        if previous_state == SubscriptionState::Retrying {
            lifecycle.activated_at = now;
            LifecycleTimestampUpdated {
                sub_id,
                event_kind: 2,
                timestamp: now,
            }
            .publish(env);
        }
        env.storage().persistent().set(&lc_key, &lifecycle);
    }

    fn apply_failure(
        env: &Env,
        data: &mut SubscriptionData,
        sub_id: u64,
        max_retries: u32,
        current_ledger: u32,
    ) {
        let key = PersistentKey::Subscription(sub_id);
        data.failure_count += 1;
        data.last_attempt_ledger = current_ledger;

        RenewalFailed {
            sub_id,
            failure_count: data.failure_count,
            ledger: current_ledger,
        }
        .publish(env);

        if data.failure_count > max_retries {
            data.state = SubscriptionState::Failed;
            StateTransition {
                sub_id,
                new_state: SubscriptionState::Failed,
            }
            .publish(env);

            Self::record_log(
                env,
                sub_id,
                3,
                soroban_sdk::String::from_str(env, "Renewal failed - max retries exceeded"),
            );
        } else {
            data.state = SubscriptionState::Retrying;
            StateTransition {
                sub_id,
                new_state: SubscriptionState::Retrying,
            }
            .publish(env);

            Self::record_log(
                env,
                sub_id,
                4,
                soroban_sdk::String::from_str(env, "Renewal failed - scheduled for retry"),
            );
        }

        env.storage().persistent().set(&key, &*data);
    }

    fn drop_renewal_lock(env: &Env, sub_id: u64, current_ledger: u32) {
        let lock_key = PersistentKey::RenewalLock(sub_id);
        env.storage().persistent().remove(&lock_key);
        RenewalLockReleased {
            sub_id,
            released_at: current_ledger,
        }
        .publish(env);
    }

    fn release_lock_on_error(env: &Env, sub_id: u64) {
        let lock_key = PersistentKey::RenewalLock(sub_id);
        if env.storage().persistent().has(&lock_key) {
            env.storage().persistent().remove(&lock_key);
        }
    }

    fn record_success(env: &Env, data: &SubscriptionData, sub_id: u64, amount: i128) {
        SubscriptionRenewed {
            sub_id,
            owner: data.owner.clone(),
            merchant: data.merchant.clone(),
            amount,
        }
        .publish(env);

        Self::record_log(
            env,
            sub_id,
            2,
            soroban_sdk::String::from_str(env, "Renewal successful"),
        );
    }

    fn panic_with_error(error: RenewalError) -> ! {
        match error {
            RenewalError::Validate(ValidateError::Paused) => panic!("Protocol is paused"),
            RenewalError::Validate(ValidateError::SubscriptionNotFound) => {
                panic!("Subscription not found")
            }
            RenewalError::Validate(ValidateError::FailedState) => {
                panic!("Subscription is in FAILED state")
            }
            RenewalError::Lock(LockError::Required) => panic!("Renewal lock required"),
            RenewalError::Lock(LockError::Expired) => panic!("Renewal lock expired"),
            RenewalError::Authorize(AuthorizeError::DuplicateCycle) => {
                panic!("Duplicate renewal for cycle")
            }
            RenewalError::Authorize(AuthorizeError::CooldownActive) => {
                panic!("Cooldown period active")
            }
            RenewalError::Authorize(AuthorizeError::ApprovalRejected) => {
                panic!("Invalid or expired approval")
            }
            RenewalError::Authorize(AuthorizeError::OutsideWindow) => {
                panic!("Outside renewal window")
            }
            RenewalError::Authorize(AuthorizeError::IntegrityViolation) => {
                panic!("Subscription integrity violation: parameters tampered")
            }
            RenewalError::Authorize(AuthorizeError::SpendingCapViolated) => {
                panic!("Per-subscription spending cap exceeded")
            }
            RenewalError::Authorize(AuthorizeError::GlobalCapViolated) => {
                panic!("Global user spending cap exceeded")
            }
        }
    }

    /// Query the amount currently escrowed for a subscription, awaiting merchant claim.
       pub fn get_escrow_balance(env: Env, sub_id: u64) -> i128 {
           env.storage()
               .persistent()
               .get(&PersistentKey::EscrowBalance(sub_id))
               .unwrap_or(0)
       }

       /// Claim the escrowed balance for a subscription. Only the merchant on record
       /// for that subscription may call this. Transfers the full escrowed amount
       /// from the contract's custody to the merchant and zeroes the balance.
       pub fn claim_escrow(env: Env, sub_id: u64) -> i128 {
           if Self::is_paused(env.clone()) {
               panic!("Protocol is paused");
           }
           let key = PersistentKey::Subscription(sub_id);
           let data: SubscriptionData = env
               .storage()
               .persistent()
               .get(&key)
               .expect("Subscription not found");

           // Only the merchant registered on this subscription can claim its escrow.
           data.merchant.require_auth();

           let escrow_key = PersistentKey::EscrowBalance(sub_id);
           let balance: i128 = env.storage().persistent().get(&escrow_key).unwrap_or(0);
           if balance <= 0 {
               panic!("No escrowed balance to claim");
           }

           let token_addr: Address = Self::get_token_contract(env.clone())
               .expect("Token contract not configured");
           let token_client = token::Client::new(&env, &token_addr);
           token_client.transfer(&env.current_contract_address(), &data.merchant, &balance);

           env.storage().persistent().set(&escrow_key, &0i128);

           EscrowClaimed {
               sub_id,
               merchant: data.merchant.clone(),
               amount: balance,
           }
           .publish(&env);

           balance
       }

    pub fn get_sub(env: Env, sub_id: u64) -> SubscriptionData {
        env.storage()
            .persistent()
            .get(&PersistentKey::Subscription(sub_id))
            .expect("Subscription not found")
    }

    pub fn get_lifecycle(env: Env, sub_id: u64) -> LifecycleTimestamps {
        let lc_key = PersistentKey::Lifecycle(sub_id);
        env.storage()
            .persistent()
            .get(&lc_key)
            .expect("Lifecycle data not found")
    }

    /// Set a billing window for a subscription. Admin only.
    pub fn set_window(env: Env, sub_id: u64, billing_start: u64, billing_end: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        Self::require_admin(&env);
        if billing_start >= billing_end {
            panic!("Invalid window: start must be before end");
        }
        let key = PersistentKey::Window(sub_id);
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
        let key = PersistentKey::Window(sub_id);
        env.storage().persistent().get(&key)
    }

    /// Set global spending cap for a user. Admin only.
    pub fn set_user_cap(env: Env, user: Address, cap: i128) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .set(&PersistentKey::UserCap(user.clone()), &cap);
        UserCapUpdated { user, cap }.publish(&env);
    }

    /// Get global spending cap for a user.
    pub fn get_user_cap(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&PersistentKey::UserCap(user))
            .unwrap_or(0)
    }

    /// Get current global spent amount for a user.
    pub fn get_user_spent(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&PersistentKey::UserSpent(user))
            .unwrap_or(0)
    }

    // ── Multi-sig approval management ─────────────────────────────

    /// Set the multi-sig approval threshold for a team. Admin only.
    /// `threshold` is denominated in stroops (1 XLM = 10_000_000 stroops).
    /// Renewals exceeding this amount require multi-sig approval.
    pub fn set_team_threshold(env: Env, team_id: u64, threshold: i128) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        Self::require_admin(&env);
        if threshold < 0 {
            panic!("Threshold must be non-negative");
        }
        let key = PersistentKey::TeamThreshold(team_id);
        env.storage().persistent().set(&key, &threshold);

        TeamThresholdUpdated {
            team_id,
            threshold,
        }
        .publish(&env);
    }

    /// Get the multi-sig threshold for a team.
    /// Returns the default ($100 equivalent) if not explicitly configured.
    pub fn get_team_threshold(env: Env, team_id: u64) -> i128 {
        let key = PersistentKey::TeamThreshold(team_id);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(DEFAULT_MULTISIG_THRESHOLD)
    }

    /// Set the signing window duration for a team. Admin only.
    /// `window_secs` is the number of seconds signers have to co-sign.
    pub fn set_signing_window(env: Env, team_id: u64, window_secs: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        Self::require_admin(&env);
        if window_secs == 0 {
            panic!("Signing window must be positive");
        }
        let key = PersistentKey::SigningWindow(team_id);
        env.storage().persistent().set(&key, &window_secs);
    }

    /// Get the signing window for a team (defaults to 24h).
    pub fn get_signing_window(env: Env, team_id: u64) -> u64 {
        let key = PersistentKey::SigningWindow(team_id);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(DEFAULT_SIGNING_WINDOW_SECS)
    }

    /// Create a multi-sig renewal request.
    /// Called when a renewal amount exceeds the team threshold.
    /// The `requester` must be authenticated. `required_signers` is the list
    /// of team admin addresses that must co-sign before the request is approved.
    pub fn request_multisig_renewal(
        env: Env,
        sub_id: u64,
        request_id: u64,
        team_id: u64,
        amount: i128,
        requester: Address,
        required_signers: soroban_sdk::Vec<Address>,
    ) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        requester.require_auth();

        // Validate subscription exists
        let _data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&PersistentKey::Subscription(sub_id))
            .expect("Subscription not found");

        if required_signers.is_empty() {
            panic!("At least one signer is required");
        }

        let now = env.ledger().timestamp();
        let signing_window = Self::get_signing_window(env.clone(), team_id);
        let expires_at = now + signing_window;

        let ms_key = PersistentKey::MultiSig(sub_id, request_id);

        // Prevent duplicate request IDs
        if env.storage().persistent().has(&ms_key) {
            panic!("Multi-sig request already exists");
        }

        let request = MultiSigRequest {
            sub_id,
            request_id,
            team_id,
            amount,
            requester: requester.clone(),
            required_signers: required_signers.clone(),
            collected_signers: soroban_sdk::Vec::new(&env),
            created_at: now,
            expires_at,
            status: MultiSigStatus::Pending,
        };

        env.storage().persistent().set(&ms_key, &request);

        MultiSigRequested {
            sub_id,
            request_id,
            team_id,
            amount,
            expires_at,
        }
        .publish(&env);

        // Audit log: requested
        MultiSigAuditLog {
            sub_id,
            request_id,
            decision: 1,
            actor: requester,
            timestamp: now,
        }
        .publish(&env);
    }

    /// Sign (co-approve) a pending multi-sig renewal request.
    /// The signer must be one of the `required_signers` and must authenticate.
    /// When all required signatures are collected, the status transitions to Approved.
    pub fn sign_multisig_renewal(
        env: Env,
        sub_id: u64,
        request_id: u64,
        signer: Address,
    ) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        signer.require_auth();

        let ms_key = PersistentKey::MultiSig(sub_id, request_id);

        let mut request: MultiSigRequest = env
            .storage()
            .persistent()
            .get(&ms_key)
            .expect("Multi-sig request not found");

        // Must be pending
        if request.status != MultiSigStatus::Pending {
            panic!("Multi-sig request is not pending");
        }

        // Check expiry
        let now = env.ledger().timestamp();
        if now >= request.expires_at {
            // Auto-expire
            request.status = MultiSigStatus::Expired;
            env.storage().persistent().set(&ms_key, &request);
            MultiSigExpired {
                sub_id,
                request_id,
                expired_at: now,
            }
            .publish(&env);
            MultiSigAuditLog {
                sub_id,
                request_id,
                decision: 5,
                actor: signer,
                timestamp: now,
            }
            .publish(&env);
            panic!("Multi-sig request has expired");
        }

        // Verify signer is in the required list
        let mut is_required = false;
        for required in request.required_signers.iter() {
            if required == signer {
                is_required = true;
                break;
            }
        }
        if !is_required {
            panic!("Signer is not a required approver");
        }

        // Check for duplicate signature
        for existing in request.collected_signers.iter() {
            if existing == signer {
                panic!("Signer has already signed this request");
            }
        }

        // Collect signature
        request.collected_signers.push_back(signer.clone());

        let collected = request.collected_signers.len();
        let required = request.required_signers.len();

        MultiSigSigned {
            sub_id,
            request_id,
            signer: signer.clone(),
            signatures_collected: collected,
            signatures_required: required,
        }
        .publish(&env);

        // Audit log: signed
        MultiSigAuditLog {
            sub_id,
            request_id,
            decision: 2,
            actor: signer.clone(),
            timestamp: now,
        }
        .publish(&env);

        // Check if all signatures collected
        if collected >= required {
            request.status = MultiSigStatus::Approved;

            MultiSigApproved {
                sub_id,
                request_id,
                team_id: request.team_id,
            }
            .publish(&env);

            // Audit log: approved
            MultiSigAuditLog {
                sub_id,
                request_id,
                decision: 3,
                actor: signer,
                timestamp: now,
            }
            .publish(&env);
        }

        env.storage().persistent().set(&ms_key, &request);
    }

    /// Cancel a pending multi-sig renewal request. Admin only.
    pub fn cancel_multisig_renewal(env: Env, sub_id: u64, request_id: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        Self::require_admin(&env);

        let ms_key = PersistentKey::MultiSig(sub_id, request_id);

        let mut request: MultiSigRequest = env
            .storage()
            .persistent()
            .get(&ms_key)
            .expect("Multi-sig request not found");

        if request.status != MultiSigStatus::Pending {
            panic!("Can only cancel pending requests");
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&ContractKey::Admin)
            .expect("Contract not initialized");
        let now = env.ledger().timestamp();

        request.status = MultiSigStatus::Cancelled;
        env.storage().persistent().set(&ms_key, &request);

        MultiSigCancelled {
            sub_id,
            request_id,
            cancelled_by: admin.clone(),
        }
        .publish(&env);

        // Audit log: cancelled
        MultiSigAuditLog {
            sub_id,
            request_id,
            decision: 4,
            actor: admin,
            timestamp: now,
        }
        .publish(&env);
    }

    /// Expire a multi-sig request if its signing window has elapsed.
    /// Can be called by anyone (e.g., a cron job) to garbage-collect stale requests.
    pub fn expire_multisig_renewal(env: Env, sub_id: u64, request_id: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }
        let ms_key = PersistentKey::MultiSig(sub_id, request_id);

        let mut request: MultiSigRequest = env
            .storage()
            .persistent()
            .get(&ms_key)
            .expect("Multi-sig request not found");

        if request.status != MultiSigStatus::Pending {
            panic!("Request is not pending");
        }

        let now = env.ledger().timestamp();
        if now < request.expires_at {
            panic!("Signing window has not expired yet");
        }

        request.status = MultiSigStatus::Expired;
        env.storage().persistent().set(&ms_key, &request);

        MultiSigExpired {
            sub_id,
            request_id,
            expired_at: now,
        }
        .publish(&env);

        // Audit log: expired — use requester as actor since this is automated
        MultiSigAuditLog {
            sub_id,
            request_id,
            decision: 5,
            actor: request.requester,
            timestamp: now,
        }
        .publish(&env);
    }

    /// Query a multi-sig request.
    pub fn get_multisig_request(
        env: Env,
        sub_id: u64,
        request_id: u64,
    ) -> MultiSigRequest {
        let ms_key = PersistentKey::MultiSig(sub_id, request_id);
        env.storage()
            .persistent()
            .get(&ms_key)
            .expect("Multi-sig request not found")
    }

    /// Check whether a renewal amount exceeds the team's multi-sig threshold.
    /// Returns true if multi-sig approval is required.
    pub fn requires_multisig(env: Env, team_id: u64, amount: i128) -> bool {
        let threshold = Self::get_team_threshold(env, team_id);
        amount > threshold
    }
}

#[cfg(test)]
mod renew_refactor_tests {
    use super::*;
    use soroban_sdk::test::Env;
    use soroban_sdk::{Address, BytesN, IntoVal, Vec};

    fn install_sub(env: &Env, sub_id: u64, state: SubscriptionState) -> SubscriptionData {
        let owner = Address::generate(env);
        let merchant = Address::generate(env);
        let amount: i128 = 100;
        let frequency: u64 = 1;
        let spending_cap: i128 = 0;
        let mut vals = Vec::<soroban_sdk::Val>::new(env);
        vals.push_back(merchant.clone().into_val(env));
        vals.push_back(amount.into_val(env));
        vals.push_back(frequency.into_val(env));
        vals.push_back(spending_cap.into_val(env));
        let hash: BytesN<32> = env.crypto().sha256(&vals.to_xdr(env)).into();
        let data = SubscriptionData {
            owner,
            merchant,
            amount,
            frequency,
            spending_cap,
            integrity_hash: hash,
            state,
            failure_count: 0,
            last_attempt_ledger: 0,
        };
        env.storage()
            .persistent()
            .set(&PersistentKey::Subscription(sub_id), &data);
        data
    }

    fn install_lock(env: &Env, sub_id: u64, timeout: u32) {
        let lock_data = RenewalLockData {
            locked_at: env.ledger().sequence(),
            lock_timeout: timeout,
        };
        env.storage()
            .persistent()
            .set(&PersistentKey::RenewalLock(sub_id), &lock_data);
    }

    fn install_approval(env: &Env, sub_id: u64, approval_id: u64, amount: i128) {
        let approval = RenewalApproval {
            sub_id,
            max_spend: amount,
            expires_at: u32::MAX,
            used: false,
        };
        env.storage()
            .persistent()
            .set(&PersistentKey::Approval(sub_id, approval_id), &approval);
    }

    fn install_lifecycle(env: &Env, sub_id: u64) {
        let lifecycle = LifecycleTimestamps {
            created_at: 0,
            activated_at: 0,
            last_renewed_at: 0,
            canceled_at: 0,
        };
        env.storage()
            .persistent()
            .set(&PersistentKey::Lifecycle(sub_id), &lifecycle);
    }

    #[test]
    fn validate_error_releases_lock() {
        let env = Env::default();
        let sub_id = 1;
        install_lock(&env, sub_id, 1000);
        let result = SubscriptionRenewalContract::renew_internal(
            &env, sub_id, 1, 100i128, 3, 0, 1, true,
        );
        assert!(matches!(
            result,
            Err(RenewalError::Validate(
                ValidateError::SubscriptionNotFound
            ))
        ));
        assert!(!env
            .storage()
            .persistent()
            .has(&PersistentKey::RenewalLock(sub_id)));
    }

    #[test]
    fn lock_error_releases_stale_lock() {
        let env = Env::default();
        let sub_id = 1;
        install_sub(&env, sub_id, SubscriptionState::Active);
        install_lock(&env, sub_id, 0);
        let result = SubscriptionRenewalContract::renew_internal(
            &env, sub_id, 1, 100i128, 3, 0, 1, true,
        );
        assert!(matches!(
            result,
            Err(RenewalError::Lock(LockError::Expired))
        ));
        assert!(!env
            .storage()
            .persistent()
            .has(&PersistentKey::RenewalLock(sub_id)));
    }

    #[test]
    fn authorize_error_releases_lock() {
        let env = Env::default();
        let sub_id = 1;
        let data = install_sub(&env, sub_id, SubscriptionState::Active);
        install_lock(&env, sub_id, 1000);
        install_approval(&env, sub_id, 1, data.amount);
        install_lifecycle(&env, sub_id);
        env.storage()
            .persistent()
            .set::<PersistentKey, u64>(&PersistentKey::Cycle(sub_id), &1);

        let result = SubscriptionRenewalContract::renew_internal(
            &env,
            sub_id,
            1,
            data.amount,
            3,
            0,
            1,
            true,
        );

        assert!(matches!(
            result,
            Err(RenewalError::Authorize(
                AuthorizeError::DuplicateCycle
            ))
        ));
        assert!(!env
            .storage()
            .persistent()
            .has(&PersistentKey::RenewalLock(sub_id)));
    }

    #[test]
    fn success_releases_lock() {
        let env = Env::default();
        let sub_id = 1;
        let data = install_sub(&env, sub_id, SubscriptionState::Active);
        install_lock(&env, sub_id, 1000);
        install_approval(&env, sub_id, 1, data.amount);
        install_lifecycle(&env, sub_id);

        let result = SubscriptionRenewalContract::renew_internal(
            &env,
            sub_id,
            1,
            data.amount,
            3,
            0,
            1,
            true,
        );

        assert_eq!(result, Ok(true));
        assert!(!env
            .storage()
            .persistent()
            .has(&PersistentKey::RenewalLock(sub_id)));
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz;
