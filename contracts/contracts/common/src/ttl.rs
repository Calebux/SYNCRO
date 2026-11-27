//! # Storage TTL helpers (issue #1655)
//!
//! Soroban archives persistent entries whose TTL lapses, which would make a
//! long-lived channel, spend cap or agent registration (and any funds behind
//! it) unreachable until someone pays to restore it.
//!
//! Every contract that keeps long-lived state should route its persistent
//! reads and writes through the helpers in this module so that **every touch
//! of an entry also bumps its TTL**.  The thresholds live here, once, so they
//! are never duplicated per contract.
//!
//! `extend_ttl(key, threshold, extend_to)` is a no-op while the entry still
//! has more than `threshold` ledgers left, so calling it on every access only
//! costs a rent top-up when the entry is actually getting close to expiry.

use soroban_sdk::{Env, IntoVal, TryFromVal, Val};

/// Ledgers per day, assuming ~5 second ledger close time.
pub const DAY_IN_LEDGERS: u32 = 17_280;

/// Persistent entries (channels, caps, agents, ...): once fewer than
/// `PERSISTENT_TTL_THRESHOLD` ledgers remain, bump back up to
/// `PERSISTENT_TTL_EXTEND_TO`.
pub const PERSISTENT_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;

/// Instance storage (admin, counters, config): same policy as persistent.
pub const INSTANCE_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;

/// Extend the TTL of the contract instance storage.
pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

/// Extend the TTL of an existing persistent entry.
///
/// The entry MUST exist; Soroban panics when extending a missing key.  Prefer
/// [`persistent_get`], [`persistent_set`] and [`persistent_has`], which handle
/// that for you.
pub fn extend_persistent<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

/// Read a persistent entry and, if it exists, extend its TTL.
pub fn persistent_get<K, V>(env: &Env, key: &K) -> Option<V>
where
    K: IntoVal<Env, Val>,
    V: TryFromVal<Env, Val>,
{
    let value: Option<V> = env.storage().persistent().get(key);
    if value.is_some() {
        extend_persistent(env, key);
    }
    value
}

/// Check whether a persistent entry exists and, if so, extend its TTL.
pub fn persistent_has<K>(env: &Env, key: &K) -> bool
where
    K: IntoVal<Env, Val>,
{
    let exists = env.storage().persistent().has(key);
    if exists {
        extend_persistent(env, key);
    }
    exists
}

/// Write a persistent entry and extend its TTL.
pub fn persistent_set<K, V>(env: &Env, key: &K, value: &V)
where
    K: IntoVal<Env, Val>,
    V: IntoVal<Env, Val>,
{
    env.storage().persistent().set(key, value);
    extend_persistent(env, key);
}
