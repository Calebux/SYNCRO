#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol, Vec,
};
use syncro_common;

pub const DEFAULT_TIMELOCK_SECONDS: u64 = 172_800;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Guardians,
    GuardianCount,
    TreasuryBalance,
    WithdrawalPending(u64),
    WithdrawalCounter,
    TimelockOverride,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalRequest {
    pub id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub created_at: u64,
    pub executable_at: u64,
    pub executed: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TreasuryError {
    NotInitialized = 2100,
    AlreadyInitialized = 2101,
    Unauthorized = 2102,
    NotGuardian = 2103,
    InvalidArgument = 2104,
    TimelockNotExpired = 2105,
    WithdrawalNotFound = 2106,
    WithdrawalAlreadyExecuted = 2107,
    InsufficientBalance = 2108,
    DuplicateGuardian = 2109,
    GuardianSetFull = 2110,
}

#[contract]
pub struct FeeCollector;

#[contractimpl]
impl FeeCollector {
    pub fn init(env: Env, admin: Address, guardians: Vec<Address>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, TreasuryError::AlreadyInitialized);
        }

        let count = guardians.len();
        if count < 2 || count > 3 {
            panic_with_error!(&env, TreasuryError::InvalidArgument);
        }

        for i in 0..count {
            for j in (i + 1)..count {
                if guardians.get_unchecked(i) == guardians.get_unchecked(j) {
                    panic_with_error!(&env, TreasuryError::DuplicateGuardian);
                }
            }
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Guardians, &guardians);
        env.storage().instance().set(&DataKey::GuardianCount, &(count as u32));
        env.storage().instance().set(&DataKey::TreasuryBalance, &0i128);
        env.storage().instance().set(&DataKey::WithdrawalCounter, &0u64);
    }

    pub fn deposit(env: Env, from: Address, amount: i128) {
        Self::require_initialized(&env);
        if amount <= 0 {
            panic_with_error!(&env, TreasuryError::InvalidArgument);
        }
        from.require_auth();

        let current = env.storage().instance().get(&DataKey::TreasuryBalance).unwrap_or(0i128);
        env.storage().instance().set(&DataKey::TreasuryBalance, &(current + amount));
        env.events().publish((Symbol::new(&env, "deposit"), from), (amount, current + amount));
    }

    pub fn accrue(env: Env, from: Address, amount: i128) {
        Self::require_initialized(&env);
        if amount <= 0 {
            panic_with_error!(&env, TreasuryError::InvalidArgument);
        }
        from.require_auth();

        let current = env.storage().instance().get(&DataKey::TreasuryBalance).unwrap_or(0i128);
        env.storage().instance().set(&DataKey::TreasuryBalance, &(current + amount));
        env.events().publish((Symbol::new(&env, "accrue"), from), (amount, current + amount));
    }

    pub fn request_withdrawal(env: Env, guardian: Address, recipient: Address, amount: i128) -> u64 {
        Self::require_initialized(&env);
        if amount <= 0 {
            panic_with_error!(&env, TreasuryError::InvalidArgument);
        }
        if !Self::is_guardian(&env, &guardian) {
            panic_with_error!(&env, TreasuryError::NotGuardian);
        }
        guardian.require_auth();

        let balance = env.storage().instance().get(&DataKey::TreasuryBalance).unwrap_or(0i128);
        if amount > balance {
            panic_with_error!(&env, TreasuryError::InsufficientBalance);
        }

        let counter = env.storage().instance().get(&DataKey::WithdrawalCounter).unwrap_or(0u64) + 1;
        env.storage().instance().set(&DataKey::WithdrawalCounter, &counter);
        let timelock = Self::timelock_duration(&env);
        let request = WithdrawalRequest {
            id: counter,
            recipient: recipient.clone(),
            amount,
            created_at: env.ledger().timestamp(),
            executable_at: env.ledger().timestamp() + timelock,
            executed: false,
        };
        env.storage().persistent().set(&DataKey::WithdrawalPending(counter), &request);
        env.events().publish((Symbol::new(&env, "withdrawal_requested"), guardian), (counter, recipient, amount, request.executable_at));

        counter
    }

    pub fn execute_withdrawal(env: Env, guardian: Address, withdrawal_id: u64) {
        Self::require_initialized(&env);
        if !Self::is_guardian(&env, &guardian) {
            panic_with_error!(&env, TreasuryError::NotGuardian);
        }
        guardian.require_auth();

        let mut request: WithdrawalRequest = env.storage().persistent().get(&DataKey::WithdrawalPending(withdrawal_id)).ok_or(TreasuryError::WithdrawalNotFound).unwrap();
        if request.executed {
            panic_with_error!(&env, TreasuryError::WithdrawalAlreadyExecuted);
        }
        if env.ledger().timestamp() < request.executable_at {
            panic_with_error!(&env, TreasuryError::TimelockNotExpired);
        }

        let balance = env.storage().instance().get(&DataKey::TreasuryBalance).unwrap_or(0i128);
        if request.amount > balance {
            panic_with_error!(&env, TreasuryError::InsufficientBalance);
        }

        let new_balance = balance - request.amount;
        env.storage().instance().set(&DataKey::TreasuryBalance, &new_balance);
        request.executed = true;
        env.storage().persistent().set(&DataKey::WithdrawalPending(withdrawal_id), &request);
        env.events().publish((Symbol::new(&env, "withdrawal_executed"), guardian), (withdrawal_id, request.recipient, request.amount, new_balance));
    }

    pub fn get_balance(env: Env) -> i128 {
        Self::require_initialized(&env);
        env.storage().instance().get(&DataKey::TreasuryBalance).unwrap_or(0i128)
    }

    pub fn get_withdrawal(env: Env, withdrawal_id: u64) -> Option<WithdrawalRequest> {
        Self::require_initialized(&env);
        env.storage().persistent().get(&DataKey::WithdrawalPending(withdrawal_id))
    }

    pub fn get_guardians(env: Env) -> Vec<Address> {
        Self::require_initialized(&env);
        env.storage().instance().get(&DataKey::Guardians).expect("not initialized")
    }

    pub fn get_guardian_count(env: Env) -> u32 {
        Self::require_initialized(&env);
        env.storage().instance().get(&DataKey::GuardianCount).unwrap_or(0)
    }

    pub fn set_guardians(env: Env, admin: Address, new_guardians: Vec<Address>) {
        Self::require_initialized(&env);
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if stored_admin != admin {
            panic_with_error!(&env, TreasuryError::Unauthorized);
        }
        admin.require_auth();
        let count = new_guardians.len();
        if count < 2 || count > 3 {
            panic_with_error!(&env, TreasuryError::InvalidArgument);
        }
        for i in 0..count {
            for j in (i + 1)..count {
                if new_guardians.get_unchecked(i) == new_guardians.get_unchecked(j) {
                    panic_with_error!(&env, TreasuryError::DuplicateGuardian);
                }
            }
        }
        env.storage().instance().set(&DataKey::Guardians, &new_guardians);
        env.storage().instance().set(&DataKey::GuardianCount, &(count as u32));
    }

    pub fn set_timelock(env: Env, admin: Address, duration_seconds: u64) {
        Self::require_initialized(&env);
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if stored_admin != admin {
            panic_with_error!(&env, TreasuryError::Unauthorized);
        }
        admin.require_auth();
        if duration_seconds < 3600 {
            panic_with_error!(&env, TreasuryError::InvalidArgument);
        }
        env.storage().instance().set(&DataKey::TimelockOverride, &duration_seconds);
    }

    pub fn get_timelock(env: Env) -> u64 {
        Self::require_initialized(&env);
        Self::timelock_duration(&env)
    }

    fn require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(env, TreasuryError::NotInitialized);
        }
    }

    fn is_guardian(env: &Env, addr: &Address) -> bool {
        let guardians: Vec<Address> = env.storage().instance().get(&DataKey::Guardians).expect("not initialized");
        guardians.iter().any(|g| g == *addr)
    }

    fn timelock_duration(env: &Env) -> u64 {
        env.storage().instance().get(&DataKey::TimelockOverride).unwrap_or(DEFAULT_TIMELOCK_SECONDS)
    }
}
