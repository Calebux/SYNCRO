#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env,
};
use syncro_common;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Channel(u64),
    ChannelCount,
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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1600,
    NotInitialized = 1601,
    Unauthorized = 1602,
    ChannelNotFound = 1603,
    InvalidAmount = 1604,
    InvalidState = 1605,
    InsufficientBalance = 1606,
    DisputeWindowActive = 1607,
    DisputeWindowExpired = 1608,
    StaleState = 1609,
    CounterOverflow = 1610,
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

        env.storage()
            .persistent()
            .set(&DataKey::Channel(id), &channel);
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
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

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

        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);
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
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

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

        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);
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
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

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

        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("disputed")),
            (channel_id, balance_a, balance_b, higher_seq),
        );
        Ok(())
    }

    pub fn finalize(env: Env, channel_id: u64, expected_sequence: u64) -> Result<(), Error> {
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

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
        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);

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
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

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
        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);

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
        env.storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
    }

    /// Returns the contract version.
    /// Incremented when the implementation changes (used for deployments).
    pub fn version(_env: Env) -> u32 {
        syncro_common::version(&_env)
    }

    /// Returns the contract interface version.
    /// Incremented when public methods or error handling changes.
    /// Used to detect API mismatches at runtime.
    pub fn interface_version(_env: Env) -> u32 {
        syncro_common::interface_version_call(&_env)
    }
}

#[cfg(test)]
mod fuzz;
