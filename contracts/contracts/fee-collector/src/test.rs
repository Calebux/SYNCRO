#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env,
};

use super::*;

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian1 = Address::generate(&env);
    let guardian2 = Address::generate(&env);
    let guardian3 = Address::generate(&env);

    let contract_id = env.register_contract(None, FeeCollector);
    let guardians = vec![
        &env,
        guardian1.clone(),
        guardian2.clone(),
        guardian3.clone(),
    ];
    let client = FeeCollectorClient::new(&env, &contract_id);
    client.init(&admin, &guardians);

    (env, admin, guardian1, guardian2, guardian3)
}

#[test]
fn test_deposit_accrue_and_withdraw_with_timelock() {
    let (env, admin, guardian1, guardian2, _guardian3) = setup();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);

    let guardians = vec![&env, guardian1.clone(), guardian2.clone()];
    client.init(&admin, &guardians);

    client.deposit(&guardian1, &100i128);
    client.accrue(&guardian2, &50i128);
    assert_eq!(client.get_balance(), 150);

    let withdrawal_id = client.request_withdrawal(&guardian1, &guardian2, &60i128);
    assert_eq!(withdrawal_id, 1);

    let request = client.get_withdrawal(&withdrawal_id).unwrap();
    assert_eq!(request.amount, 60);
    assert!(!request.executed);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_withdrawal(&guardian2, &withdrawal_id);

    let updated = client.get_balance();
    assert_eq!(updated, 90);

    let executed = client.get_withdrawal(&withdrawal_id).unwrap();
    assert!(executed.executed);
}

#[test]
#[should_panic(expected = "#6")]
fn test_withdrawal_before_timelock_fails() {
    let (env, admin, guardian1, guardian2, _guardian3) = setup();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);

    let guardians = vec![&env, guardian1.clone(), guardian2.clone()];
    client.init(&admin, &guardians);

    client.deposit(&guardian1, &100i128);
    let withdrawal_id = client.request_withdrawal(&guardian1, &guardian2, &40i128);
    client.execute_withdrawal(&guardian2, &withdrawal_id);
}

#[test]
fn test_guardian_update_and_timelock_change() {
    let (env, admin, guardian1, guardian2, guardian3) = setup();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);

    let guardians = vec![
        &env,
        guardian1.clone(),
        guardian2.clone(),
        guardian3.clone(),
    ];
    client.init(&admin, &guardians);

    let new_guardians = vec![&env, guardian2.clone(), guardian3.clone()];
    client.set_guardians(&admin, &new_guardians);
    assert_eq!(client.get_guardian_count(), 2);

    client.set_timelock(&admin, &7200u64);
    assert_eq!(client.get_timelock(), 7200);
}
