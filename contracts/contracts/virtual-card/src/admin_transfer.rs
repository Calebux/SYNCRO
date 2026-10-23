#![cfg(test)]

//! Negative tests for the two-step admin transfer (issue #1659).

use super::*;
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Env, IntoVal};

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    let contract_id = env.register_contract(None, AgentSpendCapContract);
    let admin = Address::generate(&env);
    env.mock_all_auths();
    AgentSpendCapContractClient::new(&env, &contract_id).init(&admin);
    (env, contract_id, admin)
}

fn new_client<'a>(env: &'a Env, id: &'a Address) -> AgentSpendCapContractClient<'a> {
    AgentSpendCapContractClient::new(env, id)
}

#[test]
fn admin_transfer_happy_path() {
    let (env, contract_id, admin) = setup();
    let client = new_client(&env, &contract_id);
    let next = Address::generate(&env);
    client.transfer_admin(&next);
    assert_eq!(client.get_pending_admin(), Some(next.clone()));
    // Admin is unchanged until the nominee accepts.
    assert_eq!(client.get_admin().unwrap(), admin);
    client.accept_admin();
    assert_eq!(client.get_admin().unwrap(), next);
    assert_eq!(client.get_pending_admin(), None);
}

#[test]
fn non_admin_cannot_start_transfer() {
    // No blanket auth mocks: the unauthenticated call must fail because the
    // stored admin never authorized it.
    let env = Env::default();
    let contract_id = env.register_contract(None, AgentSpendCapContract);
    let client = AgentSpendCapContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.mock_all_auths();
    client.init(&admin);
    // A fresh env handle shares the ledger but has no auth mocks; any call
    // requiring admin auth now fails.
    let stranger = Address::generate(&env);
    // Simulate "non-admin" by authorizing only the stranger for the call:
    // require_admin checks the STORED admin's auth, so stranger auth fails.
    env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "transfer_admin",
            args: (stranger.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = client.try_transfer_admin(&stranger);
    assert!(res.is_err(), "non-admin must not start a transfer");
}

#[test]
fn wrong_address_cannot_accept() {
    let (env, contract_id, admin) = setup();
    let client = new_client(&env, &contract_id);
    let nominee = Address::generate(&env);
    let stranger = Address::generate(&env);
    client.transfer_admin(&nominee);
    // Authorize ONLY the stranger for accept_admin: the contract requires the
    // nominee's auth, so this must fail.
    env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "accept_admin",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    // Also scope the admin's existing blanket mock away is unnecessary:
    // mock_auths replaces mock_all_auths, so only stranger is authorized.
    let res = client.try_accept_admin();
    assert!(res.is_err(), "wrong address must not accept");
    // Admin is unchanged.
    env.mock_all_auths();
    assert_eq!(client.get_admin().unwrap(), admin);
}

#[test]
fn cancel_transfer_works() {
    let (env, contract_id, admin) = setup();
    let client = new_client(&env, &contract_id);
    let nominee = Address::generate(&env);
    client.transfer_admin(&nominee);
    assert!(client.get_pending_admin().is_some());
    client.cancel_transfer_admin();
    assert_eq!(client.get_pending_admin(), None);
    assert_eq!(client.get_admin().unwrap(), admin);
    // Accepting after cancel fails: nothing pending.
    assert!(client.try_accept_admin().is_err());
}
