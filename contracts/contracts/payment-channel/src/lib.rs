#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
};

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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentChannel {
    pub id: u64,
    pub depositor: Address,
    pub counterparty: Address,
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

    pub fn open_channel(
        env: Env,
        depositor: Address,
        counterparty: Address,
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

        let count: u64 = env.storage().instance().get(&DataKey::ChannelCount).unwrap_or(0);
        let id = count + 1;
        let now = env.ledger().timestamp();
        let channel = PaymentChannel {
            id,
            depositor: depositor.clone(),
            counterparty: counterparty.clone(),
            balance_a: deposit_amount,
            balance_b: 0,
            sequence: 0,
            state: ChannelState::Open,
            dispute_deadline: now + dispute_window,
            closing_started_at: 0,
        };

        env.storage().persistent().set(&DataKey::Channel(id), &channel);
        env.storage().instance().set(&DataKey::ChannelCount, &id);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("open")),
            (id, depositor, counterparty, deposit_amount, dispute_window),
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

        sig_a.require_auth();
        sig_b.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = sequence_number;
        channel.state = ChannelState::Open;

        env.storage().persistent().set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("state")),
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

        sig.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = seq;
        channel.state = ChannelState::Closing;
        channel.closing_started_at = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("init")),
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

        sig_a.require_auth();
        sig_b.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = higher_seq;
        channel.state = ChannelState::Dispute;

        env.storage().persistent().set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("dispute")),
            (channel_id, balance_a, balance_b, higher_seq),
        );
        Ok(())
    }

    pub fn finalize(env: Env, channel_id: u64) -> Result<(), Error> {
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

        channel.state = ChannelState::Closed;
        env.storage().persistent().set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("final")),
            (channel_id, channel.balance_a, channel.balance_b),
        );
        Ok(())
    }

    pub fn top_up(env: Env, channel_id: u64, amount: i128, depositor: Address) -> Result<(), Error> {
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

        channel.balance_a += amount;
        env.storage().persistent().set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("topup")),
            (channel_id, amount),
        );
        Ok(())
    }

    pub fn get_channel(env: Env, channel_id: u64) -> Option<PaymentChannel> {
        env.storage().persistent().get(&DataKey::Channel(channel_id))
    }
}

mod test;

#[cfg(test)]
mod fuzz;
