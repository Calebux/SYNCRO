#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, Env, String,
};

/// Current on-chain schema version for [`EscrowAgreement`] records.
pub const ESCROW_SCHEMA_VERSION: u32 = 2;
/// Latest contract-level storage version (instance [`DataKey::StorageVersion`]).
pub const STORAGE_VERSION: u32 = 2;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Escrow(u64),
    EscrowV2(u64),
    EscrowCount,
    Admin,
    StorageVersion,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EscrowState {
    /// Escrow created, awaiting funding
    Created,
    /// Funds deposited by payer
    Funded,
    /// Arbiter has approved release (second signature)
    Approved,
    /// Funds released to payee
    Released,
    /// Funds refunded to payer
    Refunded,
    /// Under dispute resolution
    Disputed,
}

/// Typed resolution outcomes for dispute resolution
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisputeResolution {
    /// Release full amount to payee
    ReleaseToPayee,
    /// Refund full amount to payer
    RefundToPayer,
    /// Split funds between parties (payee_basis_points: 0-10000)
    /// Value represents basis points for payee, remainder goes to payer
    /// Example: 7500 = 75% to payee, 25% to payer
    PartialSplit(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowAgreement {
    pub schema_version: u32,
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub arbiter: Address,
    pub token: Address,
    pub amount: i128,
    pub deposited: i128,
    pub state: EscrowState,
    pub created_at: u64,
    pub expires_at: u64,
    pub description: String,
    pub arbiter_approved: bool,
    pub payer_confirmed: bool,
    pub payee_confirmed: bool,
}

/// Legacy layout persisted before `schema_version` was introduced.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowAgreementV1 {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub arbiter: Address,
    pub token: Address,
    pub amount: i128,
    pub deposited: i128,
    pub state: EscrowState,
    pub created_at: u64,
    pub expires_at: u64,
    pub description: String,
    pub arbiter_approved: bool,
    pub payer_confirmed: bool,
    pub payee_confirmed: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    EscrowNotFound = 3,
    Unauthorized = 4,
    InvalidAmount = 5,
    InsufficientDeposit = 6,
    AlreadyFunded = 7,
    NotFunded = 8,
    AlreadyApproved = 9,
    NotApproved = 10,
    AlreadyReleased = 11,
    AlreadyRefunded = 12,
    Expired = 13,
    NotExpired = 14,
    InDispute = 15,
    NotInDispute = 16,
    SelfAsCounterparty = 17,
    SameArbiterAsParty = 18,
    InvalidBasisPoints = 19,
    ArithmeticOverflow = 20,
    CounterOverflow = 21,
    MigrationAlreadyDone = 22,
    InvalidMigrationVersion = 23,
    OutOfOrderMigration = 24,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct EscrowCreated {
    pub escrow_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub arbiter: Address,
    pub amount: i128,
}

#[contractevent]
pub struct EscrowFunded {
    pub escrow_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct EscrowApproved {
    pub escrow_id: u64,
    pub arbiter: Address,
}

#[contractevent]
pub struct StorageMigrationExecuted {
    pub from_version: u32,
    pub to_version: u32,
    pub migrated_by: Address,
}

#[contractevent]
pub struct EscrowReleased {
    pub escrow_id: u64,
    pub payee: Address,
    pub amount: i128,
}

#[contractevent]
pub struct EscrowRefunded {
    pub escrow_id: u64,
    pub payer: Address,
    pub amount: i128,
}

#[contractevent]
pub struct EscrowDisputed {
    pub escrow_id: u64,
    pub raised_by: Address,
}

#[contractevent]
pub struct EscrowResolved {
    pub escrow_id: u64,
    pub resolution: DisputeResolution,
    pub payee_amount: i128,
    pub payer_amount: i128,
}

#[contractevent]
pub struct EscrowExpired {
    pub escrow_id: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // ── Admin ─────────────────────────────────────────────────────

    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, EscrowError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &STORAGE_VERSION);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    /// Migrate contract storage to a new schema version.
    ///
    /// This function MUST be called after a contract upgrade to handle schema changes.
    /// It is idempotent and rejects out-of-order migrations.
    ///
    /// # Arguments
    /// * `from_version` — The current storage schema version (must match on-chain state)
    ///
    /// # Errors
    /// * `Unauthorized` if caller is not the admin
    /// * `MigrationAlreadyDone` if migration for this version was already executed
    /// * `OutOfOrderMigration` if from_version doesn't match current storage version
    /// * `InvalidMigrationVersion` if attempting to migrate to an unsupported version
    pub fn migrate(env: Env, from_version: u32) -> Result<(), EscrowError> {
        Self::require_admin(&env);

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(1);

        if from_version < current_version {
            return Err(EscrowError::MigrationAlreadyDone);
        }
        if from_version > current_version {
            return Err(EscrowError::OutOfOrderMigration);
        }

        let target_version = from_version + 1;
        if target_version > STORAGE_VERSION {
            return Err(EscrowError::InvalidMigrationVersion);
        }

        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &target_version);

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        StorageMigrationExecuted {
            from_version,
            to_version: target_version,
            migrated_by: admin,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_storage_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(1)
    }

    fn from_v1(v1: EscrowAgreementV1) -> EscrowAgreement {
        EscrowAgreement {
            schema_version: ESCROW_SCHEMA_VERSION,
            id: v1.id,
            payer: v1.payer,
            payee: v1.payee,
            arbiter: v1.arbiter,
            token: v1.token,
            amount: v1.amount,
            deposited: v1.deposited,
            state: v1.state,
            created_at: v1.created_at,
            expires_at: v1.expires_at,
            description: v1.description,
            arbiter_approved: v1.arbiter_approved,
            payer_confirmed: v1.payer_confirmed,
            payee_confirmed: v1.payee_confirmed,
        }
    }

    fn normalize_escrow(mut record: EscrowAgreement) -> EscrowAgreement {
        if record.schema_version < ESCROW_SCHEMA_VERSION {
            record.schema_version = ESCROW_SCHEMA_VERSION;
        }
        record
    }

    fn load_escrow(env: &Env, escrow_id: u64) -> EscrowAgreement {
        let v2_key = DataKey::EscrowV2(escrow_id);
        if let Some(record) = env
            .storage()
            .persistent()
            .get::<DataKey, EscrowAgreement>(&v2_key)
        {
            return Self::normalize_escrow(record);
        }
        let key = DataKey::Escrow(escrow_id);
        let legacy: EscrowAgreementV1 = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow not found");
        Self::from_v1(legacy)
    }

    fn store_escrow(env: &Env, escrow_id: u64, escrow: &EscrowAgreement) {
        let record = Self::normalize_escrow(escrow.clone());
        env.storage()
            .persistent()
            .set(&DataKey::EscrowV2(escrow_id), &record);
    }

    // ── Escrow lifecycle ──────────────────────────────────────────

    /// Create a new escrow agreement.
    ///
    /// # Arguments
    /// * `payer` — The party depositing funds
    /// * `payee` — The party receiving funds on successful completion
    /// * `arbiter` — The trusted third party who must approve release
    /// * `token` — The token contract address for the escrow currency
    /// * `amount` — The exact amount to lock in escrow
    /// * `expires_at` — Unix timestamp after which payer may claim refund
    /// * `description` — Human-readable description of the agreement
    ///
    /// # Security
    /// * Arbiter must be distinct from both payer and payee
    /// * Amount must be positive
    pub fn create_escrow(
        env: Env,
        payer: Address,
        payee: Address,
        arbiter: Address,
        token: Address,
        amount: i128,
        expires_at: u64,
        description: String,
    ) -> u64 {
        payer.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, EscrowError::InvalidAmount);
        }
        if payer == payee {
            panic_with_error!(&env, EscrowError::SelfAsCounterparty);
        }
        if arbiter == payer || arbiter == payee {
            panic_with_error!(&env, EscrowError::SameArbiterAsParty);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);
        let escrow_id = count
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::CounterOverflow));

        let now = env.ledger().timestamp();
        if expires_at <= now {
            panic_with_error!(&env, EscrowError::Expired);
        }

        let escrow = EscrowAgreement {
            schema_version: ESCROW_SCHEMA_VERSION,
            id: escrow_id,
            payer: payer.clone(),
            payee: payee.clone(),
            arbiter: arbiter.clone(),
            token: token.clone(),
            amount,
            deposited: 0,
            state: EscrowState::Created,
            created_at: now,
            expires_at,
            description,
            arbiter_approved: false,
            payer_confirmed: false,
            payee_confirmed: false,
        };

        Self::store_escrow(&env, escrow_id, &escrow);
        env.storage()
            .instance()
            .set(&DataKey::EscrowCount, &escrow_id);

        EscrowCreated {
            escrow_id,
            payer,
            payee,
            arbiter,
            amount,
        }
        .publish(&env);

        escrow_id
    }

    /// Deposit funds into an escrow.
    /// Only the designated payer may fund the escrow.
    /// The full `amount` must be deposited in a single call.
    pub fn deposit(env: Env, escrow_id: u64) {
        let mut escrow = Self::load_escrow(&env, escrow_id);

        if escrow.state != EscrowState::Created {
            panic_with_error!(&env, EscrowError::AlreadyFunded);
        }

        escrow.payer.require_auth();

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &escrow.payer,
            &env.current_contract_address(),
            &escrow.amount,
        );

        escrow.deposited = escrow.amount;
        escrow.state = EscrowState::Funded;

        Self::store_escrow(&env, escrow_id, &escrow);

        EscrowFunded {
            escrow_id,
            amount: escrow.amount,
        }
        .publish(&env);
    }

    /// Approve release of escrowed funds.
    ///
    /// This is the **second signature** required before funds can be withdrawn.
    /// Only the designated `arbiter` may call this.
    ///
    /// # Security
    /// * Escrow must be in `Funded` state
    /// * Arbiter authentication is strictly required
    pub fn approve_release(env: Env, escrow_id: u64) {
        let mut escrow = Self::load_escrow(&env, escrow_id);

        if escrow.state != EscrowState::Funded && escrow.state != EscrowState::Disputed {
            panic_with_error!(&env, EscrowError::NotFunded);
        }
        if escrow.arbiter_approved {
            panic_with_error!(&env, EscrowError::AlreadyApproved);
        }

        escrow.arbiter.require_auth();

        escrow.arbiter_approved = true;
        escrow.state = EscrowState::Approved;

        Self::store_escrow(&env, escrow_id, &escrow);

        EscrowApproved {
            escrow_id,
            arbiter: escrow.arbiter,
        }
        .publish(&env);
    }

    /// Release escrowed funds to the payee.
    ///
    /// # Security
    /// * Requires `arbiter_approved == true` (second signature check)
    /// * Only the designated payee may receive the funds
    /// * Escrow must be in `Approved` state
    pub fn release(env: Env, escrow_id: u64) {
        let mut escrow = Self::load_escrow(&env, escrow_id);

        if escrow.state == EscrowState::Released {
            panic_with_error!(&env, EscrowError::AlreadyReleased);
        }
        if escrow.state != EscrowState::Approved {
            panic_with_error!(&env, EscrowError::NotApproved);
        }

        // Payee must authorize receipt
        escrow.payee.require_auth();

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payee,
            &escrow.deposited,
        );

        escrow.state = EscrowState::Released;

        Self::store_escrow(&env, escrow_id, &escrow);

        EscrowReleased {
            escrow_id,
            payee: escrow.payee,
            amount: escrow.deposited,
        }
        .publish(&env);
    }

    /// Refund escrowed funds to the payer.
    ///
    /// # Conditions
    /// * BEFORE expiry: Only if arbiter has NOT approved yet
    /// * AFTER expiry: Payer may claim refund unilaterally
    ///
    /// This protects the payer from funds being locked indefinitely.
    pub fn refund(env: Env, escrow_id: u64) {
        let mut escrow = Self::load_escrow(&env, escrow_id);

        if escrow.state == EscrowState::Refunded {
            panic_with_error!(&env, EscrowError::AlreadyRefunded);
        }
        if escrow.state == EscrowState::Released {
            panic_with_error!(&env, EscrowError::AlreadyReleased);
        }
        if escrow.state != EscrowState::Funded && escrow.state != EscrowState::Approved {
            panic_with_error!(&env, EscrowError::NotFunded);
        }

        let now = env.ledger().timestamp();
        let expired = now >= escrow.expires_at;

        if expired {
            // After expiry — payer can unilaterally claim refund
            escrow.payer.require_auth();
        } else {
            // Before expiry — refund only if arbiter hasn't approved
            if escrow.arbiter_approved {
                panic_with_error!(&env, EscrowError::AlreadyApproved);
            }
            escrow.payer.require_auth();
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payer,
            &escrow.deposited,
        );

        escrow.state = EscrowState::Refunded;

        Self::store_escrow(&env, escrow_id, &escrow);

        EscrowRefunded {
            escrow_id,
            payer: escrow.payer,
            amount: escrow.deposited,
        }
        .publish(&env);
    }

    /// Raise a dispute for an escrow.
    /// Either payer or payee may raise a dispute.
    pub fn raise_dispute(env: Env, escrow_id: u64, caller: Address) {
        let mut escrow = Self::load_escrow(&env, escrow_id);

        if escrow.state != EscrowState::Funded && escrow.state != EscrowState::Approved {
            panic_with_error!(&env, EscrowError::NotFunded);
        }

        if caller != escrow.payer && caller != escrow.payee {
            panic_with_error!(&env, EscrowError::Unauthorized);
        }
        caller.require_auth();

        escrow.state = EscrowState::Disputed;

        Self::store_escrow(&env, escrow_id, &escrow);

        EscrowDisputed {
            escrow_id,
            raised_by: caller,
        }
        .publish(&env);
    }

    /// Resolve a disputed escrow.
    ///
    /// # Arguments
    /// * `resolution` — Typed resolution enum specifying how to distribute funds:
    ///   - `ReleaseToPayee`: Full amount to payee
    ///   - `RefundToPayer`: Full amount to payer
    ///   - `PartialSplit(payee_basis_points)`: Split based on basis points (0-10000)
    ///
    /// Only the designated arbiter may resolve disputes.
    ///
    /// # Security
    /// * Uses checked arithmetic to prevent overflow
    /// * Validates basis points are within 0-10000 range
    /// * Ensures total distributed equals deposited amount
    pub fn resolve_dispute(env: Env, escrow_id: u64, resolution: DisputeResolution) {
        let mut escrow = Self::load_escrow(&env, escrow_id);

        if escrow.state != EscrowState::Disputed {
            panic_with_error!(&env, EscrowError::NotInDispute);
        }

        escrow.arbiter.require_auth();

        let token_client = token::Client::new(&env, &escrow.token);
        let total_amount = escrow.deposited;

        let (payee_amount, payer_amount) = match resolution {
            DisputeResolution::ReleaseToPayee => {
                // Release full amount to payee
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.payee,
                    &total_amount,
                );
                escrow.state = EscrowState::Released;
                (total_amount, 0i128)
            }
            DisputeResolution::RefundToPayer => {
                // Refund full amount to payer
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.payer,
                    &total_amount,
                );
                escrow.state = EscrowState::Refunded;
                (0i128, total_amount)
            }
            DisputeResolution::PartialSplit(payee_basis_points) => {
                // Validate basis points
                if payee_basis_points > 10000 {
                    panic_with_error!(&env, EscrowError::InvalidBasisPoints);
                }

                // Calculate payee amount using checked arithmetic
                // Formula: payee_amount = (total_amount * payee_basis_points) / 10000
                let payee_amount = total_amount
                    .checked_mul(payee_basis_points as i128)
                    .and_then(|v| v.checked_div(10000))
                    .unwrap_or_else(|| panic_with_error!(&env, EscrowError::ArithmeticOverflow));

                // Calculate payer amount (remainder) using checked arithmetic
                let payer_amount = total_amount
                    .checked_sub(payee_amount)
                    .unwrap_or_else(|| panic_with_error!(&env, EscrowError::ArithmeticOverflow));

                // Transfer to both parties if amounts are non-zero
                if payee_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &escrow.payee,
                        &payee_amount,
                    );
                }

                if payer_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &escrow.payer,
                        &payer_amount,
                    );
                }

                // Mark as released (partial release is still a resolution)
                escrow.state = EscrowState::Released;
                (payee_amount, payer_amount)
            }
        };

        Self::store_escrow(&env, escrow_id, &escrow);

        EscrowResolved {
            escrow_id,
            resolution,
            payee_amount,
            payer_amount,
        }
        .publish(&env);
    }

    // ── Queries ───────────────────────────────────────────────────

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAgreement {
        Self::load_escrow(&env, escrow_id)
    }

    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0)
    }

    /// Check if an escrow can be refunded (either not approved yet, or expired).
    pub fn is_refundable(env: Env, escrow_id: u64) -> bool {
        let escrow = Self::load_escrow(&env, escrow_id);

        let now = env.ledger().timestamp();
        let expired = now >= escrow.expires_at;

        (escrow.state == EscrowState::Funded || escrow.state == EscrowState::Approved)
            && (expired || !escrow.arbiter_approved)
            && escrow.state != EscrowState::Released
            && escrow.state != EscrowState::Refunded
    }

    /// Check if an escrow can be released (arbiter approved and payee hasn't claimed).
    pub fn is_releasable(env: Env, escrow_id: u64) -> bool {
        let escrow = Self::load_escrow(&env, escrow_id);

        escrow.state == EscrowState::Approved
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{StellarAssetClient, TokenClient},
        Symbol, Val,
    };

    fn setup() -> (Env, Address, Address, Address, Address, TokenClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let arbiter = Address::generate(&env);

        // Create a Stellar asset token for testing
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token = TokenClient::new(&env, &sac.address());
        let asset_client = StellarAssetClient::new(&env, &sac.address());

        // Mint tokens to payer
        asset_client.mint(&payer, &10_000_000_000i128);

        (env, payer, payee, arbiter, sac.address(), token)
    }

    fn register_escrow(env: &Env) -> EscrowContractClient<'static> {
        let contract_id = env.register_contract(None, EscrowContract);
        EscrowContractClient::new(env, &contract_id)
    }

    #[test]
    fn test_full_happy_path() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Enterprise SaaS subscription");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &1_000_000_000i128, &expiry, &desc,
        );
        assert_eq!(id, 1);

        let agreement = escrow.get_escrow(&id);
        assert_eq!(agreement.state, EscrowState::Created);
        assert_eq!(agreement.amount, 1_000_000_000i128);

        // Fund
        escrow.deposit(&id);
        let funded = escrow.get_escrow(&id);
        assert_eq!(funded.state, EscrowState::Funded);
        assert_eq!(funded.deposited, 1_000_000_000i128);

        // Arbiter approves (second signature)
        escrow.approve_release(&id);
        let approved = escrow.get_escrow(&id);
        assert_eq!(approved.state, EscrowState::Approved);
        assert!(approved.arbiter_approved);

        // Payee releases
        escrow.release(&id);
        let released = escrow.get_escrow(&id);
        assert_eq!(released.state, EscrowState::Released);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn test_release_without_arbiter_approval_fails() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &1_000_000_000i128, &expiry, &desc,
        );
        escrow.deposit(&id);

        // Try to release without arbiter approval — should panic
        escrow.release(&id);
    }

    #[test]
    fn test_refund_before_approval() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &500_000_000i128, &expiry, &desc,
        );
        escrow.deposit(&id);

        let before = escrow.get_escrow(&id);
        assert_eq!(before.state, EscrowState::Funded);

        escrow.refund(&id);
        let after = escrow.get_escrow(&id);
        assert_eq!(after.state, EscrowState::Refunded);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_refund_after_approval_fails_before_expiry() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &500_000_000i128, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.approve_release(&id);

        // Refund after approval but before expiry — should panic
        escrow.refund(&id);
    }

    #[test]
    fn test_refund_after_expiry_unilateral() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let now = env.ledger().timestamp();
        let expiry = now + 100;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &500_000_000i128, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.approve_release(&id);

        // Advance ledger past expiry
        env.ledger().set_timestamp(expiry + 1);

        // Now payer can refund even though arbiter approved
        escrow.refund(&id);
        let refunded = escrow.get_escrow(&id);
        assert_eq!(refunded.state, EscrowState::Refunded);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")]
    fn test_arbiter_cannot_be_party() {
        let (env, payer, payee, _arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        // Arbiter same as payee — should panic
        escrow.create_escrow(
            &payer, &payee, &payee, &token, &1_000_000_000i128, &expiry, &desc,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #17)")]
    fn test_payer_cannot_be_payee() {
        let (env, payer, _payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        // Payer same as payee — should panic
        escrow.create_escrow(
            &payer, &payer, &arbiter, &token, &1_000_000_000i128, &expiry, &desc,
        );
    }

    #[test]
    fn test_dispute_and_resolve_to_payee() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &1_000_000_000i128, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        let disputed = escrow.get_escrow(&id);
        assert_eq!(disputed.state, EscrowState::Disputed);

        // Arbiter resolves in favor of payee
        escrow.resolve_dispute(&id, &DisputeResolution::ReleaseToPayee);
        let resolved = escrow.get_escrow(&id);
        assert_eq!(resolved.state, EscrowState::Released);
    }

    #[test]
    fn test_dispute_and_resolve_to_payer() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &1_000_000_000i128, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payee);

        // Arbiter resolves in favor of payer (refund)
        escrow.resolve_dispute(&id, &DisputeResolution::RefundToPayer);
        let resolved = escrow.get_escrow(&id);
        assert_eq!(resolved.state, EscrowState::Refunded);
    }

    #[test]
    fn test_funds_locked_without_second_signature() {
        let (env, payer, payee, arbiter, token, token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &1_000_000_000i128, &expiry, &desc,
        );

        // Check payer balance before deposit
        let payer_balance_before = token_client.balance(&payer);
        let contract_balance_before = token_client.balance(&env.register_contract(None, EscrowContract));

        escrow.deposit(&id);

        // Funds have moved from payer to contract
        let payer_balance_after = token_client.balance(&payer);
        assert_eq!(payer_balance_after, payer_balance_before - 1_000_000_000i128);

        // Without arbiter approval, payee cannot release
        // (tested by test_release_without_arbiter_approval_fails above)

        // Verify state
        let agreement = escrow.get_escrow(&id);
        assert_eq!(agreement.state, EscrowState::Funded);
        assert!(!agreement.arbiter_approved);
    }

    // ── Partial Split Tests ──────────────────────────────────────

    #[test]
    fn test_partial_split_50_50() {
        let (env, payer, payee, arbiter, token, token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");
        let amount = 1_000_000_000i128;

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        // 50/50 split: 5000 basis points = 50%
        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(5000));

        let payer_balance_after = token_client.balance(&payer);
        let payee_balance_after = token_client.balance(&payee);

        // Each should receive 500,000,000
        assert_eq!(payee_balance_after - payee_balance_before, 500_000_000i128);
        assert_eq!(payer_balance_after - payer_balance_before, 500_000_000i128);

        let resolved = escrow.get_escrow(&id);
        assert_eq!(resolved.state, EscrowState::Released);
    }

    #[test]
    fn test_partial_split_75_25() {
        let (env, payer, payee, arbiter, token, token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");
        let amount = 1_000_000_000i128;

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payee);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        // 75/25 split: 7500 basis points = 75% to payee
        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(7500));

        let payer_balance_after = token_client.balance(&payer);
        let payee_balance_after = token_client.balance(&payee);

        // Payee gets 75%, payer gets 25%
        assert_eq!(payee_balance_after - payee_balance_before, 750_000_000i128);
        assert_eq!(payer_balance_after - payer_balance_before, 250_000_000i128);

        let resolved = escrow.get_escrow(&id);
        assert_eq!(resolved.state, EscrowState::Released);
    }

    #[test]
    fn test_partial_split_all_to_payee() {
        let (env, payer, payee, arbiter, token, token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");
        let amount = 1_000_000_000i128;

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        // 100% to payee: 10000 basis points
        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(10000));

        let payer_balance_after = token_client.balance(&payer);
        let payee_balance_after = token_client.balance(&payee);

        // Payee gets 100%, payer gets 0%
        assert_eq!(payee_balance_after - payee_balance_before, amount);
        assert_eq!(payer_balance_after - payer_balance_before, 0i128);
    }

    #[test]
    fn test_partial_split_all_to_payer() {
        let (env, payer, payee, arbiter, token, token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");
        let amount = 1_000_000_000i128;

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payee);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        // 0% to payee, 100% to payer: 0 basis points
        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(0));

        let payer_balance_after = token_client.balance(&payer);
        let payee_balance_after = token_client.balance(&payee);

        // Payee gets 0%, payer gets 100%
        assert_eq!(payee_balance_after - payee_balance_before, 0i128);
        assert_eq!(payer_balance_after - payer_balance_before, amount);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")]
    fn test_partial_split_invalid_basis_points_too_high() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &1_000_000_000i128, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        // Invalid: basis points > 10000
        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(10001));
    }

    #[test]
    fn test_partial_split_with_odd_amount() {
        let (env, payer, payee, arbiter, token, token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");
        let amount = 999_999i128; // Odd amount that doesn't divide evenly

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        // 33.33% to payee (3333 basis points)
        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(3333));

        let payer_balance_after = token_client.balance(&payer);
        let payee_balance_after = token_client.balance(&payee);

        let payee_received = payee_balance_after - payee_balance_before;
        let payer_received = payer_balance_after - payer_balance_before;

        // Verify total conservation
        assert_eq!(payee_received + payer_received, amount);
        
        // Verify payee got approximately 33.33%
        // (999,999 * 3333) / 10000 = 333,299 (integer division)
        assert_eq!(payee_received, 333_299i128);
        assert_eq!(payer_received, 666_700i128);
    }

    #[test]
    fn test_partial_split_preserves_total() {
        let (env, payer, payee, arbiter, token, token_client) = setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Test");
        let amount = 987_654_321i128;

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        // Random split: 6543 basis points (65.43%)
        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(6543));

        let payer_balance_after = token_client.balance(&payer);
        let payee_balance_after = token_client.balance(&payee);

        let payee_received = payee_balance_after - payee_balance_before;
        let payer_received = payer_balance_after - payer_balance_before;

        // Critical: verify no funds are lost or created
        assert_eq!(payee_received + payer_received, amount);
    }

    // ── Schema migration tests ─────────────────────────────────────

    #[test]
    fn test_v1_escrow_survives_storage_migration() {
        let (env, payer, payee, arbiter, token, _token_client) = setup();
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);

        // Simulate pre-upgrade on-chain state: legacy v1 layout, storage version 1.
        let expiry = env.ledger().timestamp() + 86400;
        let desc = String::from_str(&env, "Legacy escrow");
        let legacy = EscrowAgreementV1 {
            id: 1,
            payer: payer.clone(),
            payee: payee.clone(),
            arbiter: arbiter.clone(),
            token: token.clone(),
            amount: 2_000_000_000i128,
            deposited: 2_000_000_000i128,
            state: EscrowState::Funded,
            created_at: env.ledger().timestamp(),
            expires_at: expiry,
            description: desc,
            arbiter_approved: false,
            payer_confirmed: false,
            payee_confirmed: false,
        };
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageVersion, &1u32);
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(1u64), &legacy);
            env.storage()
                .instance()
                .set(&DataKey::EscrowCount, &1u64);
        });

        // Admin runs the one-step storage migration after WASM upgrade.
        client.migrate(&1u32);

        let agreement = client.get_escrow(&1u64);
        assert_eq!(agreement.schema_version, ESCROW_SCHEMA_VERSION);
        assert_eq!(agreement.amount, 2_000_000_000i128);
        assert_eq!(agreement.payer, payer);
        assert_eq!(agreement.payee, payee);
        assert_eq!(agreement.state, EscrowState::Funded);
        assert_eq!(client.get_storage_version(), STORAGE_VERSION);

        // Write path lazily re-persists the upgraded record.
        client.approve_release(&1u64);
        let upgraded = client.get_escrow(&1u64);
        assert_eq!(upgraded.schema_version, ESCROW_SCHEMA_VERSION);
        assert!(upgraded.arbiter_approved);
    }

    #[test]
    fn test_migrate_rejects_out_of_order_and_is_idempotent() {
        let (env, _payer, _payee, _arbiter, _token, _token_client) = setup();
        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);

        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageVersion, &1u32);
        });

        client.migrate(&1u32);
        assert_eq!(client.get_storage_version(), STORAGE_VERSION);

        // Already migrated — repeating the same step is rejected.
        let repeat = client.try_migrate(&1u32);
        assert_eq!(repeat, Err(Ok(EscrowError::MigrationAlreadyDone)));

        // Skipping ahead is rejected.
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageVersion, &1u32);
        });
        let skip = client.try_migrate(&2u32);
        assert_eq!(skip, Err(Ok(EscrowError::OutOfOrderMigration)));
    }
}

#[cfg(test)]
mod fuzz;
