#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, String,
};

#[cfg(test)]
mod test;

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum ContractKey {
    Admin,
    DisputeAdmin,
    Paused,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Charge(u64),
    Dispute(u64),
}

// ── Data Types ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    None,
    Pending,
    Approved,
    Rejected,
    Resolved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChargeRecord {
    pub payment_ref: u64,
    pub sub_id: u64,
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub charged_at: u64,
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeRecord {
    pub payment_ref: u64,
    pub raised_by: Address,
    pub reason: String,
    pub status: DisputeStatus,
    pub created_at: u64,
    pub resolved_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RefundError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ChargeNotFound = 4,
    AlreadyRefunded = 5,
    InvalidAmount = 6,
    DisputeNotFound = 7,
    DisputeAlreadyExists = 8,
    DisputeNotApproved = 9,
    ContractPaused = 10,
    ChargeAlreadyExists = 11,
}

// ── Contract Events ──────────────────────────────────────────────────────────

#[contractevent]
pub struct ChargeRecorded {
    pub payment_ref: u64,
    pub sub_id: u64,
    pub payer: Address,
    pub merchant: Address,
    pub amount: i128,
    pub token: Address,
}

#[contractevent]
pub struct DisputeOpened {
    pub payment_ref: u64,
    pub raised_by: Address,
    pub reason: String,
}

#[contractevent]
pub struct DisputeAuthorized {
    pub payment_ref: u64,
    pub approved: bool,
    pub resolver: Address,
}

#[contractevent]
pub struct RefundProcessed {
    pub payment_ref: u64,
    pub sub_id: u64,
    pub payer: Address,
    pub merchant: Address,
    pub amount: i128,
    pub token: Address,
    pub refunded_by: Address,
}

#[contractevent]
pub struct AdminUpdated {
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
pub struct DisputeAdminUpdated {
    pub old_dispute_admin: Address,
    pub new_dispute_admin: Address,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SubscriptionRefundContract;

#[contractimpl]
impl SubscriptionRefundContract {
    /// Initialize contract with admin and dispute_admin
    pub fn init(env: Env, admin: Address, dispute_admin: Address) {
        if env.storage().instance().has(&ContractKey::Admin) {
            panic_with_error!(&env, RefundError::AlreadyInitialized);
        }
        env.storage().instance().set(&ContractKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&ContractKey::DisputeAdmin, &dispute_admin);
        env.storage().instance().set(&ContractKey::Paused, &false);
    }

    /// Record a completed subscription charge on-chain.
    /// Can be called by merchant or admin.
    pub fn record_charge(
        env: Env,
        payment_ref: u64,
        sub_id: u64,
        payer: Address,
        merchant: Address,
        token: Address,
        amount: i128,
    ) {
        Self::require_not_paused(&env);

        if amount <= 0 {
            panic_with_error!(&env, RefundError::InvalidAmount);
        }

        // Auth requirement: merchant or admin
        if merchant.has_auth() {
            merchant.require_auth();
        } else {
            let admin = Self::get_admin(&env);
            admin.require_auth();
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Charge(payment_ref))
        {
            panic_with_error!(&env, RefundError::ChargeAlreadyExists);
        }

        let charge = ChargeRecord {
            payment_ref,
            sub_id,
            payer: payer.clone(),
            merchant: merchant.clone(),
            token: token.clone(),
            amount,
            charged_at: env.ledger().timestamp(),
            refunded: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Charge(payment_ref), &charge);

        env.events().publish(
            (payment_ref, sub_id),
            ChargeRecorded {
                payment_ref,
                sub_id,
                payer,
                merchant,
                amount,
                token,
            },
        );
    }

    /// Open a dispute against a completed charge.
    /// Can be called by payer or admin.
    pub fn open_dispute(env: Env, payment_ref: u64, reason: String) {
        Self::require_not_paused(&env);

        let charge: ChargeRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Charge(payment_ref))
            .unwrap_or_else(|| panic_with_error!(&env, RefundError::ChargeNotFound));

        if charge.refunded {
            panic_with_error!(&env, RefundError::AlreadyRefunded);
        }

        // Auth requirement: payer or admin
        let raised_by = if charge.payer.has_auth() {
            charge.payer.require_auth();
            charge.payer.clone()
        } else {
            let admin = Self::get_admin(&env);
            admin.require_auth();
            admin
        };

        if env
            .storage()
            .persistent()
            .has(&DataKey::Dispute(payment_ref))
        {
            panic_with_error!(&env, RefundError::DisputeAlreadyExists);
        }

        let dispute = DisputeRecord {
            payment_ref,
            raised_by: raised_by.clone(),
            reason: reason.clone(),
            status: DisputeStatus::Pending,
            created_at: env.ledger().timestamp(),
            resolved_at: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(payment_ref), &dispute);

        env.events().publish(
            (payment_ref, raised_by.clone()),
            DisputeOpened {
                payment_ref,
                raised_by,
                reason,
            },
        );
    }

    /// Dispute admin or admin authorizes or rejects a dispute.
    pub fn authorize_dispute(env: Env, payment_ref: u64, approve: bool) {
        Self::require_not_paused(&env);

        let resolver = Self::require_dispute_admin_or_admin(&env);

        let mut dispute: DisputeRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(payment_ref))
            .unwrap_or_else(|| panic_with_error!(&env, RefundError::DisputeNotFound));

        dispute.status = if approve {
            DisputeStatus::Approved
        } else {
            DisputeStatus::Rejected
        };

        if !approve {
            dispute.resolved_at = env.ledger().timestamp();
        }

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(payment_ref), &dispute);

        env.events().publish(
            (payment_ref, resolver.clone()),
            DisputeAuthorized {
                payment_ref,
                approved: approve,
                resolver,
            },
        );
    }

    /// Process a refund for a payment reference.
    /// Reverses the completed charge by transferring tokens back to the subscriber.
    /// Supported authorization paths:
    /// 1. Direct voluntary merchant refund (merchant auth)
    /// 2. Authorized dispute refund (dispute admin / admin auth with approved dispute)
    ///
    /// DOUBLE-REFUND PREVENTION: Rejects any attempt to refund a charge that is already refunded.
    pub fn process_refund(env: Env, payment_ref: u64) {
        Self::require_not_paused(&env);

        let mut charge: ChargeRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Charge(payment_ref))
            .unwrap_or_else(|| panic_with_error!(&env, RefundError::ChargeNotFound));

        // CRITICAL DOUBLE-REFUND PREVENTION CHECK
        if charge.refunded {
            panic_with_error!(&env, RefundError::AlreadyRefunded);
        }

        let mut dispute_opt: Option<DisputeRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(payment_ref));

        let refunded_by: Address;

        if charge.merchant.has_auth() {
            charge.merchant.require_auth();
            refunded_by = charge.merchant.clone();
        } else {
            refunded_by = Self::require_dispute_admin_or_admin(&env);
            if let Some(ref dispute) = dispute_opt {
                if dispute.status != DisputeStatus::Approved {
                    panic_with_error!(&env, RefundError::DisputeNotApproved);
                }
            } else {
                panic_with_error!(&env, RefundError::DisputeNotFound);
            }
        }

        // Mark refunded FIRST before external token interaction
        charge.refunded = true;
        env.storage()
            .persistent()
            .set(&DataKey::Charge(payment_ref), &charge);

        // Update dispute record if present
        if let Some(mut dispute) = dispute_opt {
            dispute.status = DisputeStatus::Resolved;
            dispute.resolved_at = env.ledger().timestamp();
            env.storage()
                .persistent()
                .set(&DataKey::Dispute(payment_ref), &dispute);
        }

        // Execute token refund from merchant to subscriber
        let token_client = token::Client::new(&env, &charge.token);
        token_client.transfer(&charge.merchant, &charge.payer, &charge.amount);

        // Emit refund event
        env.events().publish(
            (payment_ref, charge.sub_id),
            RefundProcessed {
                payment_ref,
                sub_id: charge.sub_id,
                payer: charge.payer,
                merchant: charge.merchant,
                amount: charge.amount,
                token: charge.token,
                refunded_by,
            },
        );
    }

    /// Check if a charge has been refunded
    pub fn is_refunded(env: Env, payment_ref: u64) -> bool {
        let charge: ChargeRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Charge(payment_ref))
            .unwrap_or_else(|| panic_with_error!(&env, RefundError::ChargeNotFound));
        charge.refunded
    }

    /// Retrieve charge details by payment reference
    pub fn get_charge(env: Env, payment_ref: u64) -> ChargeRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Charge(payment_ref))
            .unwrap_or_else(|| panic_with_error!(&env, RefundError::ChargeNotFound))
    }

    /// Retrieve dispute details by payment reference
    pub fn get_dispute(env: Env, payment_ref: u64) -> DisputeRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(payment_ref))
            .unwrap_or_else(|| panic_with_error!(&env, RefundError::DisputeNotFound))
    }

    /// Update contract admin
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&ContractKey::Admin, &new_admin);
        env.events().publish(
            (&admin, &new_admin),
            AdminUpdated {
                old_admin: admin,
                new_admin,
            },
        );
    }

    /// Update dispute admin
    pub fn set_dispute_admin(env: Env, new_dispute_admin: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        let old_dispute_admin = Self::get_dispute_admin(&env);
        env.storage()
            .instance()
            .set(&ContractKey::DisputeAdmin, &new_dispute_admin);
        env.events().publish(
            (&old_dispute_admin, &new_dispute_admin),
            DisputeAdminUpdated {
                old_dispute_admin,
                new_dispute_admin,
            },
        );
    }

    /// Set contract paused state
    pub fn set_paused(env: Env, paused: bool) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage().instance().set(&ContractKey::Paused, &paused);
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&ContractKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RefundError::NotInitialized))
    }

    fn get_dispute_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&ContractKey::DisputeAdmin)
            .unwrap_or_else(|| panic_with_error!(env, RefundError::NotInitialized))
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&ContractKey::Paused)
            .unwrap_or(false);
        if paused {
            panic_with_error!(env, RefundError::ContractPaused);
        }
    }

    fn require_dispute_admin_or_admin(env: &Env) -> Address {
        let dispute_admin = Self::get_dispute_admin(env);
        if dispute_admin.has_auth() {
            dispute_admin.require_auth();
            return dispute_admin;
        }

        let admin = Self::get_admin(env);
        if admin.has_auth() {
            admin.require_auth();
            return admin;
        }

        panic_with_error!(env, RefundError::Unauthorized)
    }
}
