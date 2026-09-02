#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
};
use syncro_common;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    VoucherCount,
    Voucher(u64),
    VoucherCode(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VoucherState {
    Active = 1,
    Redeemed = 2,
    Voided = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Voucher {
    pub id: u64,
    pub code_hash: BytesN<32>,
    pub recipient: Address,
    pub face_value: i128,
    pub remaining_value: i128,
    pub state: VoucherState,
    pub issued_at: u64,
    pub redeemed_at: u64,
    pub voided_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VoucherError {
    AlreadyInitialized = 2000,
    NotInitialized = 2001,
    Unauthorized = 2002,
    InvalidAmount = 2003,
    VoucherNotFound = 2004,
    VoucherInactive = 2005,
    DuplicateVoucher = 2006,
    InsufficientBalance = 2007,
}

#[contractevent]
pub struct VoucherMinted {
    pub voucher_id: u64,
    pub recipient: Address,
    pub face_value: i128,
    pub code_hash: BytesN<32>,
}

#[contractevent]
pub struct VoucherRedeemed {
    pub voucher_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub remaining_value: i128,
}

#[contractevent]
pub struct VoucherVoided {
    pub voucher_id: u64,
    pub remaining_value: i128,
}

#[contract]
pub struct VoucherLedgerContract;

#[contractimpl]
impl VoucherLedgerContract {
    pub fn init(env: Env, admin: Address) -> Result<(), VoucherError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VoucherError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VoucherCount, &0u64);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, VoucherError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VoucherError::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    fn load_voucher(env: &Env, voucher_id: u64) -> Result<Voucher, VoucherError> {
        env.storage()
            .persistent()
            .get(&DataKey::Voucher(voucher_id))
            .ok_or(VoucherError::VoucherNotFound)
    }

    pub fn mint_voucher(
        env: Env,
        recipient: Address,
        face_value: i128,
        code_hash: BytesN<32>,
    ) -> Result<u64, VoucherError> {
        Self::require_admin(&env)?;

        if face_value <= 0 {
            return Err(VoucherError::InvalidAmount);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::VoucherCode(code_hash.clone()))
        {
            return Err(VoucherError::DuplicateVoucher);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VoucherCount)
            .unwrap_or(0);
        let voucher_id = count + 1;
        let now = env.ledger().timestamp();

        let voucher = Voucher {
            id: voucher_id,
            code_hash: code_hash.clone(),
            recipient: recipient.clone(),
            face_value,
            remaining_value: face_value,
            state: VoucherState::Active,
            issued_at: now,
            redeemed_at: 0,
            voided_at: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Voucher(voucher_id), &voucher);
        env.storage()
            .persistent()
            .set(&DataKey::VoucherCode(code_hash.clone()), &voucher_id);
        env.storage()
            .instance()
            .set(&DataKey::VoucherCount, &voucher_id);

        VoucherMinted {
            voucher_id,
            recipient,
            face_value,
            code_hash,
        }
        .publish(&env);

        Ok(voucher_id)
    }

    pub fn redeem_voucher(
        env: Env,
        voucher_id: u64,
        recipient: Address,
        amount: i128,
    ) -> Result<i128, VoucherError> {
        recipient.require_auth();

        let mut voucher = Self::load_voucher(&env, voucher_id)?;
        if voucher.recipient != recipient {
            return Err(VoucherError::Unauthorized);
        }
        if voucher.state != VoucherState::Active {
            return Err(VoucherError::VoucherInactive);
        }
        if amount <= 0 || amount > voucher.remaining_value {
            return Err(VoucherError::InsufficientBalance);
        }

        voucher.remaining_value -= amount;
        if voucher.remaining_value == 0 {
            voucher.state = VoucherState::Redeemed;
            voucher.redeemed_at = env.ledger().timestamp();
        }

        env.storage()
            .persistent()
            .set(&DataKey::Voucher(voucher_id), &voucher);

        VoucherRedeemed {
            voucher_id,
            recipient,
            amount,
            remaining_value: voucher.remaining_value,
        }
        .publish(&env);

        Ok(amount)
    }

    pub fn void_voucher(env: Env, voucher_id: u64) -> Result<(), VoucherError> {
        Self::require_admin(&env)?;

        let mut voucher = Self::load_voucher(&env, voucher_id)?;
        if voucher.state != VoucherState::Active {
            return Err(VoucherError::VoucherInactive);
        }

        voucher.state = VoucherState::Voided;
        voucher.remaining_value = 0;
        voucher.voided_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Voucher(voucher_id), &voucher);

        VoucherVoided {
            voucher_id,
            remaining_value: 0,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_voucher(env: Env, voucher_id: u64) -> Result<Voucher, VoucherError> {
        Self::load_voucher(&env, voucher_id)
    }

    pub fn balance(env: Env, voucher_id: u64) -> Result<i128, VoucherError> {
        Ok(Self::load_voucher(&env, voucher_id)?.remaining_value)
    }

    pub fn is_active(env: Env, voucher_id: u64) -> bool {
        matches!(Self::load_voucher(&env, voucher_id), Ok(voucher) if voucher.state == VoucherState::Active && voucher.remaining_value > 0)
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
mod test;
#[cfg(test)]
mod negative;

