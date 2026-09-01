#![no_std]

use soroban_sdk::{contracterror, Env, Symbol};

/// Typed error returned by the shared counter helper when a counter increment
/// would overflow its `u64` storage. All structured identifiers across the
/// Syncro contracts are issued through [`next_counter_id`], and this error
/// prevents silent wraparound or a raw panic.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum CounterError {
    /// The identifier counter reached its maximum value and cannot be
    /// incremented further.
    Overflow = 1,
}

/// Issue the next monotonically-increasing `u64` identifier for a contract.
///
/// The counter is stored in *instance* storage under the caller-supplied
/// `key`. Reading an absent key yields `0`, so the first issued id is `1`.
///
/// The increment is guarded against overflow and returns a [`CounterError`]
/// instead of wrapping or panicking.
///
/// # Arguments
/// * `env` — The contract environment.
/// * `key` — A storage key unique to the object type being issued (for
///   example `Symbol::new(env, "CardCounter")`).
///
/// # Returns
/// * `Ok(id)` — The next identifier, already persisted as the new counter.
/// * `Err(CounterError::Overflow)` — The counter is at its maximum value.
pub fn next_counter_id(env: &Env, key: Symbol) -> Result<u64, CounterError> {
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current.checked_add(1).ok_or(CounterError::Overflow)?;
    env.storage().instance().set(&key, &next);
    Ok(next)
}
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {}

    fn setup() -> (Env, Address, Symbol) {
        let env = Env::default();
        let addr = env.register(Dummy, ());
        let key = Symbol::new(&env, "TestCounter");
        (env, addr, key)
    }

    /// Run `f` inside an as-contract context so instance storage is reachable.
    fn in_contract<T>(env: &Env, addr: &Address, f: impl FnOnce() -> T) -> T {
        env.as_contract(addr, f)
    }

    #[test]
    fn first_id_is_one() {
        let (env, addr, key) = setup();
        let id = in_contract(&env, &addr, || next_counter_id(&env, key.clone()).unwrap());
        assert_eq!(id, 1);
    }

    #[test]
    fn ids_are_monotonic_and_incrementing() {
        let (env, addr, key) = setup();
        let mut expected = 1u64;
        for _ in 0..100 {
            let id = in_contract(&env, &addr, || {
                next_counter_id(&env, key.clone()).unwrap()
            });
            assert_eq!(id, expected);
            expected += 1;
        }
    }

    #[test]
    fn counters_are_isolated_by_key() {
        let (env, addr, _) = setup();
        let key_a = Symbol::new(&env, "CounterA");
        let key_b = Symbol::new(&env, "CounterB");

        let a1 = in_contract(&env, &addr, || next_counter_id(&env, key_a.clone()).unwrap());
        let b1 = in_contract(&env, &addr, || next_counter_id(&env, key_b.clone()).unwrap());
        let a2 = in_contract(&env, &addr, || next_counter_id(&env, key_a.clone()).unwrap());

        assert_eq!(a1, 1);
        assert_eq!(a2, 2);
        assert_eq!(b1, 1);
    }

    #[test]
    fn overflow_returns_typed_error() {
        let (env, addr, key) = setup();

        // Saturate the counter to u64::MAX before the next read.
        in_contract(&env, &addr, || env.storage().instance().set(&key.clone(), &u64::MAX));

        let err = in_contract(&env, &addr, || next_counter_id(&env, key.clone()).unwrap_err());
        assert_eq!(err, CounterError::Overflow);

        // The stored counter must be left untouched after a failed increment.
        let stored = in_contract(&env, &addr, || {
            env.storage().instance().get::<_, u64>(&key.clone()).unwrap()
        });
        assert_eq!(stored, u64::MAX);
    }
}
