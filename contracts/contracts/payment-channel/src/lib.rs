#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, vec, Address, Env, Vec,
};

/// Maximum watchtower bounty that can be reserved from a channel, in token units.
/// Caps the amount a watchtower can ever receive; channel principal cannot be redirected.
pub const MAX_WATCHTOWER_BOUNTY: i128 = 10_000;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Channel(u64),
    ChannelCount,
    Watchtowers(u64),
    WatchtowerBounty(u64),
    BountyPaid(u64),
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
    NotWatchtower = 12,
    WatchtowerAlreadyRegistered = 13,
    BountyExceedsCap = 14,
    InvalidBounty = 15,
    WatchtowerIsParty = 16,
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

        // Unused bounty returns to the depositor; a watchtower never claims it
        // unless they successfully submitted a newer state during the window.
        let bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);
        let paid: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BountyPaid(channel_id))
            .unwrap_or(false);
        if bounty > 0 && !paid {
            token_client.transfer(
                &env.current_contract_address(),
                &depositor,
                &bounty,
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

    /// Register `watchtower` to submit a newer signed state on `party`'s behalf.
    ///
    /// `bounty` is reserved from the depositor's on-chain balance and paid to
    /// the watchtower on a successful `watchtower_submit`. It is capped by
    /// `MAX_WATCHTOWER_BOUNTY` and can never exceed the remaining `balance_a`.
    /// A watchtower cannot be a channel party, so they cannot redirect principal.
    pub fn register_watchtower(
        env: Env,
        channel_id: u64,
        party: Address,
        watchtower: Address,
        bounty: i128,
    ) -> Result<(), Error> {
        party.require_auth();

        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if party != channel.depositor && party != channel.counterparty {
            return Err(Error::Unauthorized);
        }
        if watchtower == channel.depositor || watchtower == channel.counterparty {
            return Err(Error::WatchtowerIsParty);
        }

        let mut towers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env]);
        if towers.iter().any(|t| t == watchtower) {
            return Err(Error::WatchtowerAlreadyRegistered);
        }

        let existing_bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);

        if bounty < 0 {
            return Err(Error::InvalidBounty);
        }
        if bounty > MAX_WATCHTOWER_BOUNTY {
            return Err(Error::BountyExceedsCap);
        }

        // Only the depositor may fund a new bounty, and only once per channel.
        if bounty > 0 {
            if party != channel.depositor {
                return Err(Error::Unauthorized);
            }
            if existing_bounty > 0 {
                return Err(Error::InvalidBounty);
            }
            if bounty > channel.balance_a {
                return Err(Error::InsufficientBalance);
            }
            channel.balance_a -= bounty;
            env.storage()
                .persistent()
                .set(&DataKey::WatchtowerBounty(channel_id), &bounty);
            env.storage()
                .persistent()
                .set(&DataKey::BountyPaid(channel_id), &false);
            env.storage()
                .persistent()
                .set(&DataKey::Channel(channel_id), &channel);
        }

        towers.push_back(watchtower.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Watchtowers(channel_id), &towers);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("wt_reg")),
            (channel_id, party, watchtower, bounty),
        );
        Ok(())
    }

    /// Remove a previously registered watchtower. Unused bounty is restored to
    /// the depositor when the last watchtower is removed.
    pub fn deregister_watchtower(
        env: Env,
        channel_id: u64,
        party: Address,
        watchtower: Address,
    ) -> Result<(), Error> {
        party.require_auth();

        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if party != channel.depositor && party != channel.counterparty {
            return Err(Error::Unauthorized);
        }

        let towers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env]);
        if !towers.iter().any(|t| t == watchtower) {
            return Err(Error::NotWatchtower);
        }

        let mut remaining: Vec<Address> = vec![&env];
        for t in towers.iter() {
            if t != watchtower {
                remaining.push_back(t);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::Watchtowers(channel_id), &remaining);

        let paid: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BountyPaid(channel_id))
            .unwrap_or(false);
        let bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);
        if remaining.is_empty() && bounty > 0 && !paid {
            channel.balance_a += bounty;
            env.storage()
                .persistent()
                .set(&DataKey::Channel(channel_id), &channel);
            env.storage()
                .persistent()
                .set(&DataKey::WatchtowerBounty(channel_id), &0i128);
        }

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("wt_dereg")),
            (channel_id, party, watchtower),
        );
        Ok(())
    }

    pub fn get_watchtowers(env: Env, channel_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env])
    }

    pub fn get_watchtower_bounty(env: Env, channel_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0)
    }

    /// Submit a newer dual-signed state during the dispute window.
    ///
    /// The caller must be a registered watchtower (not a channel party).
    /// Principal still settles only to `depositor` / `counterparty` on
    /// `finalize`; the watchtower may receive at most the reserved bounty.
    pub fn watchtower_submit(
        env: Env,
        channel_id: u64,
        watchtower: Address,
        balance_a: i128,
        balance_b: i128,
        sequence_number: u64,
        sig_a: Address,
        sig_b: Address,
    ) -> Result<(), Error> {
        watchtower.require_auth();

        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Closing && channel.state != ChannelState::Dispute {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() > channel.dispute_deadline {
            return Err(Error::DisputeWindowExpired);
        }
        if sequence_number <= channel.sequence {
            return Err(Error::StaleState);
        }
        if balance_a < 0 || balance_b < 0 {
            return Err(Error::InvalidAmount);
        }

        let towers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env]);
        if !towers.iter().any(|t| t == watchtower) {
            return Err(Error::NotWatchtower);
        }
        if !((sig_a == channel.depositor && sig_b == channel.counterparty)
            || (sig_a == channel.counterparty && sig_b == channel.depositor))
        {
            return Err(Error::Unauthorized);
        }

        sig_a.require_auth();
        sig_b.require_auth();

        let bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);
        let paid: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BountyPaid(channel_id))
            .unwrap_or(false);

        // EFFECTS — persist dispute state and mark bounty paid before transfer.
        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = sequence_number;
        channel.state = ChannelState::Dispute;
        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);

        if bounty > 0 && !paid {
            env.storage()
                .persistent()
                .set(&DataKey::BountyPaid(channel_id), &true);
        }

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("wt_sub")),
            (channel_id, watchtower.clone(), balance_a, balance_b, sequence_number),
        );

        // INTERACTIONS — watchtower is paid the capped bounty only.
        if bounty > 0 && !paid {
            let token_client = token::Client::new(&env, &channel.token);
            token_client.transfer(
                &env.current_contract_address(),
                &watchtower,
                &bounty,
            );
        }

        Ok(())
    }
}

mod test;

#[cfg(test)]
mod adversarial;

#[cfg(test)]
mod fuzz;
