#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _, vec, Address, BytesN, Env, String,
};

use super::*;

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let guardian1 = Address::generate(&env);
    let guardian2 = Address::generate(&env);
    let guardian3 = Address::generate(&env);

    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let guardians = vec![&env, guardian1.clone(), guardian2.clone(), guardian3.clone()];
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    client.init(&admin, &guardians);

    (env, admin, guardian1, guardian2, guardian3)
}

#[test]
fn test_initialize() {
    let (env, admin, g1, g2, g3) = setup();
    let client = ContractUpgradeGovernanceClient::new(
        &env,
        &env.register_contract(None, ContractUpgradeGovernance),
    );

    let guardians = vec![&env, g1.clone(), g2.clone(), g3.clone()];
    client.init(&admin, &guardians);

    let stored: Vec<Address> = client.get_guardians();
    assert_eq!(stored.len(), 3);
    assert_eq!(client.get_guardian_count(), 3);
    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "AlreadyInitialized")]
fn test_double_init_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let admin = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);
    let guardians = vec![&env, g1, g2];
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    client.init(&admin, &guardians);
    client.init(&admin, &guardians);
}

#[test]
#[should_panic(expected = "InvalidArgument")]
fn test_init_fewer_than_2_guardians_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let admin = Address::generate(&env);
    let g1 = Address::generate(&env);
    let guardians = vec![&env, g1];
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    client.init(&admin, &guardians);
}

#[test]
#[should_panic(expected = "InvalidArgument")]
fn test_init_more_than_3_guardians_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let admin = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);
    let g3 = Address::generate(&env);
    let g4 = Address::generate(&env);
    let guardians = vec![&env, g1, g2, g3, g4];
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    client.init(&admin, &guardians);
}

#[test]
fn test_propose_upgrade() {
    let (env, _admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1.clone(), g2.clone()];
    client.init(&_admin, &guardians);

    let target = String::from_str(&env, "CAFEBABE");
    let new_hash = BytesN::from_array(&env, &[1u8; 32]);
    let old_hash = BytesN::from_array(&env, &[0u8; 32]);
    let desc = String::from_str(&env, "Upgrade v2");

    // As a guardian (g1), propose an upgrade
    let proposal_id = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &desc);
    assert_eq!(proposal_id, 1);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.state, ProposalState::Pending);
    assert_eq!(proposal.description, desc);
    assert_eq!(proposal.target_contract, target);
    assert_eq!(proposal.proposer, g1);
}

#[test]
fn test_approve_upgrade_reaches_threshold() {
    let (env, _admin, g1, g2, g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1.clone(), g2.clone(), g3.clone()];
    client.init(&_admin, &guardians);

    let target = String::from_str(&env, "CAFEBABE");
    let new_hash = BytesN::from_array(&env, &[2u8; 32]);
    let old_hash = BytesN::from_array(&env, &[1u8; 32]);

    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));

    // First approval (1 of 2)
    client.approve_upgrade(&pid, &g2);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Pending); // still pending

    // Second approval (2 of 2) — threshold reached
    client.approve_upgrade(&pid, &g3);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Approved);
    assert!(proposal.executable_at > 0);
}

#[test]
fn test_execute_upgrade_after_timelock() {
    let (mut env, _admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1.clone(), g2.clone()];
    client.init(&_admin, &guardians);

    let target = String::from_str(&env, "CAFEBABE");
    let new_hash = BytesN::from_array(&env, &[2u8; 32]);
    let old_hash = BytesN::from_array(&env, &[1u8; 32]);

    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);

    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Approved);

    // Jump forward past the default timelock (172800 seconds)
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);

    // Now execute
    let exec_hash = BytesN::from_array(&env, &[2u8; 32]);
    client.execute_upgrade(&pid, &g1, &exec_hash);

    let executed = client.get_proposal(&pid);
    assert_eq!(executed.state, ProposalState::Executed);

    // Rollback should be available
    assert!(client.is_rollback_available());
    let rollback_hash = client.get_rollback_wasm_hash().unwrap();
    assert_eq!(rollback_hash, old_hash);
}

#[test]
fn test_rollback_upgrade() {
    let (mut env, admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1.clone(), g2.clone()];
    client.init(&admin, &guardians);

    let target = String::from_str(&env, "CAFEBABE");
    let new_hash = BytesN::from_array(&env, &[2u8; 32]);
    let old_hash = BytesN::from_array(&env, &[1u8; 32]);

    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid, &g1, &new_hash);

    // Admin rollback
    client.rollback_upgrade(&admin, &old_hash);
    assert!(!client.is_rollback_available());
}

#[test]
#[should_panic(expected = "TimelockNotExpired")]
fn test_execute_before_timelock_fails() {
    let (env, _admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1.clone(), g2.clone()];
    client.init(&_admin, &guardians);

    let target = String::from_str(&env, "CAFEBABE");
    let new_hash = BytesN::from_array(&env, &[2u8; 32]);
    let old_hash = BytesN::from_array(&env, &[1u8; 32]);

    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);

    // Execute without jumping past timelock — should fail
    client.execute_upgrade(&pid, &g1, &new_hash);
}

#[test]
fn test_set_guardians() {
    let (env, admin, g1, g2, g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1.clone(), g2.clone(), g3.clone()];
    client.init(&admin, &guardians);

    let new_guardians = vec![&env, g2.clone(), g3.clone()];
    client.set_guardians(&new_guardians);

    let stored = client.get_guardians();
    assert_eq!(stored.len(), 2);
}

#[test]
fn test_pause_toggle() {
    let (env, admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1, g2];
    client.init(&admin, &guardians);

    assert!(!client.is_paused());
    client.toggle_pause();
    assert!(client.is_paused());
    client.toggle_pause();
    assert!(!client.is_paused());
}

#[test]
fn test_set_timelock() {
    let (env, admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1, g2];
    client.init(&admin, &guardians);

    assert_eq!(client.get_timelock(), DEFAULT_TIMELOCK_SECONDS);
    client.set_timelock(&7200u64); // 2 hours
    assert_eq!(client.get_timelock(), 7200);
}

#[test]
#[should_panic(expected = "InvalidArgument")]
fn test_set_timelock_below_minimum_fails() {
    let (env, admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1, g2];
    client.init(&admin, &guardians);
    client.set_timelock(&300u64); // 5 min — below 1 hour minimum
}

#[test]
fn test_cancel_proposal() {
    let (env, _admin, g1, g2, _g3) = setup();
    let contract_id = env.register_contract(None, ContractUpgradeGovernance);
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);

    let guardians = vec![&env, g1.clone(), g2.clone()];
    client.init(&_admin, &guardians);

    let pid = client.propose_upgrade(
        &g1,
        &String::from_str(&env, "CAFE"),
        &BytesN::from_array(&env, &[2u8; 32]),
        &BytesN::from_array(&env, &[1u8; 32]),
        &String::from_str(&env, "v2"),
    );

    client.cancel_proposal(&pid);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Cancelled);
}
