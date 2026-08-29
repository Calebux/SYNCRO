#![no_std]

//! # Dispute Arbitration / Resolver Registry
//!
//! Escrow dispute resolution is normally admin-only: a single trusted arbiter
//! unilaterally decides every dispute. This contract decentralizes that
//! authority into a **registry of arbiters** who **vote** on dispute outcomes.
//! Once a configurable **quorum** of arbiters agree on an outcome, the registry
//! issues a **binding cross-contract call into the escrow** to release the funds
//! to the payee or refund the payer.
//!
//! ## Wiring
//! For the binding callback to succeed, the escrow's `arbiter` must be set to
//! *this registry's contract address*. The escrow's `resolve_dispute` requires
//! the arbiter's authorization, and a contract implicitly authorizes the calls
//! it makes — so only a quorum-backed decision from this registry can move the
//! escrowed funds.
//!
//! ## Outcomes
//! Outcome codes match the escrow's `resolve_dispute` resolution argument:
//! * `1` — release funds to the payee
//! * `2` — refund funds to the payer

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, IntoVal, Symbol, Val, Vec,
};

// ── Outcome codes (mirror escrow::resolve_dispute) ─────────────────────────────

const OUTCOME_UNDECIDED: u32 = 0;
const OUTCOME_RELEASE: u32 = 1;
const OUTCOME_REFUND: u32 = 2;

// ── Storage keys ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Arbiters,
    Quorum,
    Case(u64),
    CaseCount,
    /// Records the outcome a given arbiter voted for on a given case.
    Vote(u64, Address),
}

// ── Data types ─────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaseStatus {
    /// Accepting votes.
    Open,
    /// Quorum reached and the escrow callback has fired.
    Resolved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeCase {
    pub id: u64,
    /// Address of the escrow contract holding the disputed funds.
    pub escrow: Address,
    /// Identifier of the disputed agreement within that escrow contract.
    pub escrow_id: u64,
    pub status: CaseStatus,
    /// Winning outcome once resolved (0 while still open).
    pub outcome: u32,
    /// Tally of votes to release funds to the payee.
    pub votes_release: u32,
    /// Tally of votes to refund funds to the payer.
    pub votes_refund: u32,
    pub created_at: u64,
    pub resolved_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    NotAnArbiter = 4,
    AlreadyArbiter = 5,
    InvalidQuorum = 6,
    CaseNotFound = 7,
    CaseClosed = 8,
    AlreadyVoted = 9,
    InvalidOutcome = 10,
    NoArbiters = 11,
}

// ── Events ─────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct ArbiterAdded {
    pub arbiter: Address,
}

#[contractevent]
pub struct ArbiterRemoved {
    pub arbiter: Address,
}

#[contractevent]
pub struct QuorumSet {
    pub quorum: u32,
}

#[contractevent]
pub struct CaseOpened {
    pub case_id: u64,
    pub escrow: Address,
    pub escrow_id: u64,
}

#[contractevent]
pub struct VoteCast {
    pub case_id: u64,
    pub arbiter: Address,
    pub outcome: u32,
    pub votes_release: u32,
    pub votes_refund: u32,
}

#[contractevent]
pub struct CaseResolved {
    pub case_id: u64,
    pub escrow: Address,
    pub escrow_id: u64,
    pub outcome: u32,
}

// ── Contract ───────────────────────────────────────────────────────────────────

#[contract]
pub struct ResolverRegistry;

#[contractimpl]
impl ResolverRegistry {
    // ── Admin ─────────────────────────────────────────────────────

    /// Initialize the registry with an administrator and an initial quorum.
    ///
    /// The quorum is the number of matching votes required to bind an outcome.
    pub fn init(env: Env, admin: Address, quorum: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, RegistryError::AlreadyInitialized);
        }
        if quorum == 0 {
            panic_with_error!(&env, RegistryError::InvalidQuorum);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.storage()
            .instance()
            .set(&DataKey::Arbiters, &Vec::<Address>::new(&env));
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RegistryError::NotInitialized));
        admin.require_auth();
    }

    fn arbiters(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Arbiters)
            .unwrap_or_else(|| panic_with_error!(env, RegistryError::NotInitialized))
    }

    /// Add an arbiter to the voting set. Admin only.
    pub fn add_arbiter(env: Env, arbiter: Address) {
        Self::require_admin(&env);
        let mut arbiters = Self::arbiters(&env);
        if arbiters.contains(&arbiter) {
            panic_with_error!(&env, RegistryError::AlreadyArbiter);
        }
        arbiters.push_back(arbiter.clone());
        env.storage().instance().set(&DataKey::Arbiters, &arbiters);
        ArbiterAdded { arbiter }.publish(&env);
    }

    /// Remove an arbiter from the voting set. Admin only.
    ///
    /// Votes already cast on open cases keep their tally; only future voting
    /// power is revoked.
    pub fn remove_arbiter(env: Env, arbiter: Address) {
        Self::require_admin(&env);
        let arbiters = Self::arbiters(&env);
        let index = arbiters
            .first_index_of(&arbiter)
            .unwrap_or_else(|| panic_with_error!(&env, RegistryError::NotAnArbiter));
        let mut updated = arbiters;
        updated.remove(index);
        env.storage().instance().set(&DataKey::Arbiters, &updated);
        ArbiterRemoved { arbiter }.publish(&env);
    }

    /// Update the quorum required to bind an outcome. Admin only.
    pub fn set_quorum(env: Env, quorum: u32) {
        Self::require_admin(&env);
        if quorum == 0 {
            panic_with_error!(&env, RegistryError::InvalidQuorum);
        }
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        QuorumSet { quorum }.publish(&env);
    }

    // ── Cases ─────────────────────────────────────────────────────

    /// Open a dispute case bound to a specific escrow agreement.
    ///
    /// Only a registered arbiter or the admin may open a case. The escrow must
    /// already be in its disputed state for the eventual resolution callback to
    /// succeed.
    pub fn open_case(env: Env, opener: Address, escrow: Address, escrow_id: u64) -> u64 {
        opener.require_auth();
        Self::require_arbiter_or_admin(&env, &opener);

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CaseCount)
            .unwrap_or(0);
        let case_id = count + 1;

        let now = env.ledger().timestamp();
        let case = DisputeCase {
            id: case_id,
            escrow: escrow.clone(),
            escrow_id,
            status: CaseStatus::Open,
            outcome: OUTCOME_UNDECIDED,
            votes_release: 0,
            votes_refund: 0,
            created_at: now,
            resolved_at: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Case(case_id), &case);
        env.storage().instance().set(&DataKey::CaseCount, &case_id);

        CaseOpened {
            case_id,
            escrow,
            escrow_id,
        }
        .publish(&env);

        case_id
    }

    /// Cast a vote on an open case for a given `outcome` (1 = release, 2 =
    /// refund). When either tally reaches the quorum, the case is resolved and
    /// a binding `resolve_dispute` call is issued into the escrow contract.
    pub fn vote(env: Env, arbiter: Address, case_id: u64, outcome: u32) {
        arbiter.require_auth();

        if outcome != OUTCOME_RELEASE && outcome != OUTCOME_REFUND {
            panic_with_error!(&env, RegistryError::InvalidOutcome);
        }
        if !Self::arbiters(&env).contains(&arbiter) {
            panic_with_error!(&env, RegistryError::NotAnArbiter);
        }

        let mut case = Self::load_case(&env, case_id);
        if case.status != CaseStatus::Open {
            panic_with_error!(&env, RegistryError::CaseClosed);
        }

        let vote_key = DataKey::Vote(case_id, arbiter.clone());
        if env.storage().persistent().has(&vote_key) {
            panic_with_error!(&env, RegistryError::AlreadyVoted);
        }
        env.storage().persistent().set(&vote_key, &outcome);

        if outcome == OUTCOME_RELEASE {
            case.votes_release += 1;
        } else {
            case.votes_refund += 1;
        }

        VoteCast {
            case_id,
            arbiter,
            outcome,
            votes_release: case.votes_release,
            votes_refund: case.votes_refund,
        }
        .publish(&env);

        let quorum: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Quorum)
            .unwrap_or_else(|| panic_with_error!(&env, RegistryError::NotInitialized));

        // Resolve as soon as a single outcome reaches quorum.
        let winning = if case.votes_release >= quorum {
            OUTCOME_RELEASE
        } else if case.votes_refund >= quorum {
            OUTCOME_REFUND
        } else {
            OUTCOME_UNDECIDED
        };

        if winning != OUTCOME_UNDECIDED {
            case.status = CaseStatus::Resolved;
            case.outcome = winning;
            case.resolved_at = env.ledger().timestamp();

            // Binding callback into the escrow contract. This registry must be
            // the escrow's designated arbiter for the call to be authorized.
            let mut args: Vec<Val> = Vec::new(&env);
            args.push_back(case.escrow_id.into_val(&env));
            args.push_back(winning.into_val(&env));
            env.invoke_contract::<()>(&case.escrow, &Symbol::new(&env, "resolve_dispute"), args);

            CaseResolved {
                case_id,
                escrow: case.escrow.clone(),
                escrow_id: case.escrow_id,
                outcome: winning,
            }
            .publish(&env);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Case(case_id), &case);
    }

    // ── Queries ───────────────────────────────────────────────────

    pub fn get_case(env: Env, case_id: u64) -> DisputeCase {
        Self::load_case(&env, case_id)
    }

    pub fn get_case_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CaseCount)
            .unwrap_or(0)
    }

    pub fn get_quorum(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Quorum)
            .unwrap_or_else(|| panic_with_error!(&env, RegistryError::NotInitialized))
    }

    pub fn get_arbiters(env: Env) -> Vec<Address> {
        Self::arbiters(&env)
    }

    pub fn is_arbiter(env: Env, arbiter: Address) -> bool {
        Self::arbiters(&env).contains(&arbiter)
    }

    /// The outcome a given arbiter voted for on a case, or 0 if they have not
    /// voted.
    pub fn get_vote(env: Env, case_id: u64, arbiter: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Vote(case_id, arbiter))
            .unwrap_or(OUTCOME_UNDECIDED)
    }

    // ── Internal helpers ──────────────────────────────────────────

    fn load_case(env: &Env, case_id: u64) -> DisputeCase {
        env.storage()
            .persistent()
            .get(&DataKey::Case(case_id))
            .unwrap_or_else(|| panic_with_error!(env, RegistryError::CaseNotFound))
    }

    fn require_arbiter_or_admin(env: &Env, who: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RegistryError::NotInitialized));
        if who != &admin && !Self::arbiters(env).contains(who) {
            panic_with_error!(env, RegistryError::Unauthorized);
        }
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz;
