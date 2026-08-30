#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token,
    Address, Env,
};

/// Current on-chain schema version for [`PaymentChannel`] records.
pub const CHANNEL_SCHEMA_VERSION: u32 = 2;
/// Latest contract-level storage version (instance [`DataKey::StorageVersion`]).
pub const STORAGE_VERSION: u32 = 2;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Channel(u64),
    ChannelV2(u64),
    ChannelCount,
    StorageVersion,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChannelState {
    Open = 1,
    Closing = 2,
    Dispute = 3,
    Closed = 4,
}

/// A payment channel between two parties backed by an on-chain token escrow.
///
/// # Token field
/// `token` stores the SEP-41 token contract address used for the initial
/// deposit and for disbursements on `finalize`.  Without this field the
/// contract has no way to disburse funds, which would lock balances forever.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentChannel {
    pub schema_version: u32,
    pub id: u64,
    pub depositor: Address,
    pub counterparty: Address,
    /// Token contract used for on-chain disbursement.
    pub token: Address,
    pub balance_a: i128,
    pub balance_b: i128,
    pub sequence: u64,
    pub state: ChannelState,
    pub dispute_deadline: u64,
    pub closing_started_at: u64,
}

/// Legacy layout persisted before `schema_version` was introduced.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentChannelV1 {
    pub id: u64,
    pub depositor: Address,
    pub counterparty: Address,
    pub token: Address,
    pub balance_a: i128,
    pub balance_b: i128,
    pub sequence: u64,
    pub state: ChannelState,
    pub dispute_deadline: u64,
    pub closing_started_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ChannelNotFound = 4,
    InvalidAmount = 5,
    InvalidState = 6,
    InsufficientBalance = 7,
    DisputeWindowActive = 8,
    DisputeWindowExpired = 9,
    StaleState = 10,
    CounterOverflow = 11,
    MigrationAlreadyDone = 12,
    InvalidMigrationVersion = 13,
    OutOfOrderMigration = 14,
}

#[contractevent]
pub struct StorageMigrationExecuted {
    pub from_version: u32,
    pub to_version: u32,
    pub migrated_by: Address,
}

#[contract]
pub struct PaymentChannelContract;

#[contractimpl]
impl PaymentChannelContract {
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &STORAGE_VERSION);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
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
    pub fn migrate(env: Env, from_version: u32) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(1);

        if from_version < current_version {
            return Err(Error::MigrationAlreadyDone);
        }
        if from_version > current_version {
            return Err(Error::OutOfOrderMigration);
        }

        let target_version = from_version + 1;
        if target_version > STORAGE_VERSION {
            return Err(Error::InvalidMigrationVersion);
        }

        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &target_version);

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

    fn from_v1(v1: PaymentChannelV1) -> PaymentChannel {
        PaymentChannel {
            schema_version: CHANNEL_SCHEMA_VERSION,
            id: v1.id,
            depositor: v1.depositor,
            counterparty: v1.counterparty,
            token: v1.token,
            balance_a: v1.balance_a,
            balance_b: v1.balance_b,
            sequence: v1.sequence,
            state: v1.state,
            dispute_deadline: v1.dispute_deadline,
            closing_started_at: v1.closing_started_at,
        }
    }

    fn normalize_channel(mut record: PaymentChannel) -> PaymentChannel {
        if record.schema_version < CHANNEL_SCHEMA_VERSION {
            record.schema_version = CHANNEL_SCHEMA_VERSION;
        }
        record
    }

    fn load_channel(env: &Env, channel_id: u64) -> Result<PaymentChannel, Error> {
        let v2_key = DataKey::ChannelV2(channel_id);
        if let Some(record) = env
            .storage()
            .persistent()
            .get::<DataKey, PaymentChannel>(&v2_key)
        {
            return Ok(Self::normalize_channel(record));
        }
        let key = DataKey::Channel(channel_id);
        if let Some(legacy) = env
            .storage()
            .persistent()
            .get::<DataKey, PaymentChannelV1>(&key)
        {
            return Ok(Self::from_v1(legacy));
        }
        Err(Error::ChannelNotFound)
    }

    fn store_channel(env: &Env, channel_id: u64, channel: &PaymentChannel) {
        let record = Self::normalize_channel(channel.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ChannelV2(channel_id), &record);
    }

    /// Open a new payment channel.
    ///
    /// `token` is the SEP-41 token contract.  The depositor must have
    /// pre-approved the contract to spend `deposit_amount` tokens (via the
    /// standard token allowance mechanism), which this call then transfers
    /// into contract escrow.
    pub fn open_channel(
        env: Env,
        depositor: Address,
        counterparty: Address,
        token: Address,
        deposit_amount: i128,
        dispute_window: u64,
    ) -> Result<u64, Error> {
        depositor.require_auth();

        if deposit_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if depositor == counterparty {
            return Err(Error::Unauthorized);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ChannelCount)
            .unwrap_or(0);
        let id = count.checked_add(1).ok_or(Error::CounterOverflow)?;
        let now = env.ledger().timestamp();

        // ── EFFECTS — record the channel state ───────────────────────────────
        let channel = PaymentChannel {
            schema_version: CHANNEL_SCHEMA_VERSION,
            id,
            depositor: depositor.clone(),
            counterparty: counterparty.clone(),
            token: token.clone(),
            balance_a: deposit_amount,
            balance_b: 0,
            sequence: 0,
            state: ChannelState::Open,
            dispute_deadline: now + dispute_window,
            closing_started_at: 0,
        };

        Self::store_channel(&env, id, &channel);
        env.storage()
            .instance()
            .set(&DataKey::ChannelCount, &id);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("opened")),
            (id, depositor.clone(), counterparty, deposit_amount, dispute_window),
        );

        // ── INTERACTIONS — pull funds from depositor ─────────────────────────
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &depositor,
            &env.current_contract_address(),
            &deposit_amount,
        );

        Ok(id)
    }

    pub fn submit_state(
        env: Env,
        channel_id: u64,
        balance_a: i128,
        balance_b: i128,
        sequence_number: u64,
        sig_a: Address,
        sig_b: Address,
    ) -> Result<(), Error> {
        let mut channel = Self::load_channel(&env, channel_id)?;

        if channel.state != ChannelState::Open && channel.state != ChannelState::Closing {
            return Err(Error::InvalidState);
        }
        if sequence_number <= channel.sequence {
            return Err(Error::StaleState);
        }
        if !((sig_a == channel.depositor && sig_b == channel.counterparty)
            || (sig_a == channel.counterparty && sig_b == channel.depositor))
        {
            return Err(Error::Unauthorized);
        }

        sig_a.require_auth();
        sig_b.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = sequence_number;
        channel.state = ChannelState::Open;

        Self::store_channel(&env, channel_id, &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("submitted")),
            (channel_id, balance_a, balance_b, sequence_number),
        );
        Ok(())
    }

    pub fn initiate_close(
        env: Env,
        channel_id: u64,
        balance_a: i128,
        balance_b: i128,
        seq: u64,
        sig: Address,
    ) -> Result<(), Error> {
        let mut channel = Self::load_channel(&env, channel_id)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if seq <= channel.sequence {
            return Err(Error::StaleState);
        }
        if sig != channel.depositor && sig != channel.counterparty {
            return Err(Error::Unauthorized);
        }

        sig.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = seq;
        channel.state = ChannelState::Closing;
        channel.closing_started_at = env.ledger().timestamp();

        Self::store_channel(&env, channel_id, &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("closing")),
            (channel_id, balance_a, balance_b, seq),
        );
        Ok(())
    }

    pub fn dispute(
        env: Env,
        channel_id: u64,
        balance_a: i128,
        balance_b: i128,
        higher_seq: u64,
        sig_a: Address,
        sig_b: Address,
    ) -> Result<(), Error> {
        let mut channel = Self::load_channel(&env, channel_id)?;

        if channel.state != ChannelState::Closing {
            return Err(Error::InvalidState);
        }
        if higher_seq <= channel.sequence {
            return Err(Error::StaleState);
        }
        if env.ledger().timestamp() > channel.dispute_deadline {
            return Err(Error::DisputeWindowExpired);
        }
        if !((sig_a == channel.depositor && sig_b == channel.counterparty)
            || (sig_a == channel.counterparty && sig_b == channel.depositor))
        {
            return Err(Error::Unauthorized);
        }

        sig_a.require_auth();
        sig_b.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = higher_seq;
        channel.state = ChannelState::Dispute;

        Self::store_channel(&env, channel_id, &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("disputed")),
            (channel_id, balance_a, balance_b, higher_seq),
        );
        Ok(())
    }

    pub fn finalize(env: Env, channel_id: u64, expected_sequence: u64) -> Result<(), Error> {
        let mut channel = Self::load_channel(&env, channel_id)?;

        if channel.state != ChannelState::Closing && channel.state != ChannelState::Dispute {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() <= channel.dispute_deadline {
            return Err(Error::DisputeWindowActive);
        }
        if expected_sequence != channel.sequence {
            return Err(Error::StaleState);
        }

        // Capture values needed after the state mutation.
        let depositor = channel.depositor.clone();
        let counterparty = channel.counterparty.clone();
        let token_addr = channel.token.clone();
        let balance_a = channel.balance_a;
        let balance_b = channel.balance_b;

        // ── EFFECTS ─────────────────────────────────────────────────────────
        // Mark closed and persist BEFORE any external call.  A re-entrant
        // `finalize` call would now fail the `InvalidState` guard above.
        channel.state = ChannelState::Closed;
        Self::store_channel(&env, channel_id, &channel);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("closed")),
            (channel_id, channel.balance_a, channel.balance_b),
        );

        // ── INTERACTIONS ─────────────────────────────────────────────────────
        // Disburse escrowed funds.  Zero-value transfers are skipped.
        let token_client = token::Client::new(&env, &token_addr);

        if balance_a > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &depositor,
                &balance_a,
            );
        }

        if balance_b > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &counterparty,
                &balance_b,
            );
        }

        Ok(())
    }

    /// Add more funds to an open channel (depositor side only).
    pub fn top_up(
        env: Env,
        channel_id: u64,
        amount: i128,
        depositor: Address,
    ) -> Result<(), Error> {
        let mut channel = Self::load_channel(&env, channel_id)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        depositor.require_auth();
        if depositor != channel.depositor {
            return Err(Error::Unauthorized);
        }

        let token_addr = channel.token.clone();

        // ── EFFECTS ─────────────────────────────────────────────────────────
        channel.balance_a += amount;
        Self::store_channel(&env, channel_id, &channel);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("toppedup")),
            (channel_id, amount),
        );

        // ── INTERACTIONS ─────────────────────────────────────────────────────
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );

        Ok(())
    }

    pub fn get_channel(env: Env, channel_id: u64) -> Option<PaymentChannel> {
        Self::load_channel(&env, channel_id).ok()
    }
}

mod test;

#[cfg(test)]
mod fuzz;
