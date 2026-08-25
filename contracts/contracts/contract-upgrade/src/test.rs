#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger}, vec, Address, BytesN, Env, String,
};

use super::*;

fn setup() -> (Env, Address, Address, Address, Address, ContractUpgradeGovernanceClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian1 = Address::generate(&env);
    let guardian2 = Address::generate(&env);
    let guardian3 = Address::generate(&env);

    let contract_id = env.register(ContractUpgradeGovernance, ());
    let guardians = vec![&env, guardian1.clone(), guardian2.clone(), guardian3.clone()];
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    client.init(&admin, &guardians);

    (env, admin, guardian1, guardian2, guardian3, client)
}

fn hash(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

fn register_target(
    client: &ContractUpgradeGovernanceClient<'static>,
    env: &Env,
) -> Address {
    let target = Address::generate(env);
    client.register_governed_contract(&target, &0u64);
    target
}

#[test]
fn test_initialize() {
    let (env, admin, g1, g2, g3, _c) = setup();
    let client = ContractUpgradeGovernanceClient::new(
        &env,
        &env.register(ContractUpgradeGovernance, ()),
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
#[should_panic(expected = "Error(Contract, #2)")]
fn test_double_init_fails() {
    let env = Env::default();
    let contract_id = env.register(ContractUpgradeGovernance, ());
    let admin = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);
    let guardians = vec![&env, g1, g2];
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    client.init(&admin, &guardians);
    client.init(&admin, &guardians);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_init_fewer_than_2_guardians_fails() {
    let env = Env::default();
    let contract_id = env.register(ContractUpgradeGovernance, ());
    let admin = Address::generate(&env);
    let g1 = Address::generate(&env);
    let guardians = vec![&env, g1];
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    client.init(&admin, &guardians);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_init_more_than_3_guardians_fails() {
    let env = Env::default();
    let contract_id = env.register(ContractUpgradeGovernance, ());
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
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 1);
    let old_hash = hash(&env, 0);
    let desc = String::from_str(&env, "Upgrade v2");

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
    let (env, _admin, g1, g2, g3, client) = setup();
    let target = register_target(&client, &env);

    let pid = client.propose_upgrade(&g1, &target, &hash(&env, 2), &hash(&env, 1), &String::from_str(&env, "v2"));

    client.approve_upgrade(&pid, &g2);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Pending);

    client.approve_upgrade(&pid, &g3);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Approved);
    assert!(proposal.executable_at > 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_duplicate_approval_rejected() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let pid = client.propose_upgrade(&g1, &target, &hash(&env, 2), &hash(&env, 1), &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g1);
}

#[test]
fn test_execute_upgrade_after_timelock() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let old_hash = hash(&env, 1);

    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);

    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid, &g1, &target, &new_hash);

    let executed = client.get_proposal(&pid);
    assert_eq!(executed.state, ProposalState::Executed);
    assert!(client.is_rollback_available(&target));
    let rollback_hash = client.get_rollback_wasm_hash(&target).unwrap();
    assert_eq!(rollback_hash, old_hash);
}

#[test]
fn test_rollback_upgrade() {
    let (env, admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let old_hash = hash(&env, 1);

    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid, &g1, &target, &new_hash);

    client.rollback_upgrade(&admin, &target, &old_hash);
    assert!(!client.is_rollback_available(&target));
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_rollback_cannot_be_replayed() {
    let (env, admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let old_hash = hash(&env, 1);

    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid, &g1, &target, &new_hash);

    client.rollback_upgrade(&admin, &target, &old_hash);
    client.rollback_upgrade(&admin, &target, &old_hash);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_execute_before_timelock_fails() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let pid = client.propose_upgrade(&g1, &target, &new_hash, &hash(&env, 1), &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    client.execute_upgrade(&pid, &g1, &target, &new_hash);
}

#[test]
fn test_set_guardians() {
    let (env, _admin, _g1, g2, g3, client) = setup();
    let new_guardians = vec![&env, g2.clone(), g3.clone()];
    client.set_guardians(&new_guardians);
    assert_eq!(client.get_guardians().len(), 2);
}

#[test]
fn test_pause_toggle() {
    let (_env, _admin, _g1, _g2, _g3, client) = setup();
    assert!(!client.is_paused());
    client.toggle_pause();
    assert!(client.is_paused());
    client.toggle_pause();
    assert!(!client.is_paused());
}

#[test]
fn test_set_timelock() {
    let (_env, _admin, _g1, _g2, _g3, client) = setup();
    assert_eq!(client.get_timelock(), DEFAULT_TIMELOCK_SECONDS);
    client.set_timelock(&7200u64);
    assert_eq!(client.get_timelock(), 7200);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_timelock_below_minimum_fails() {
    let (_env, _admin, _g1, _g2, _g3, client) = setup();
    client.set_timelock(&300u64);
}

#[test]
fn test_cancel_proposal() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let pid = client.propose_upgrade(
        &g1,
        &target,
        &hash(&env, 2),
        &hash(&env, 1),
        &String::from_str(&env, "v2"),
    );
    client.cancel_proposal(&pid);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Cancelled);
}

// ── Per-target rollback & registry (#1255) ───────────────────────────────────

#[test]
fn rollback_slots_are_per_target() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target_a = register_target(&client, &env);
    let target_b = register_target(&client, &env);
    let hash_a_old = hash(&env, 1);
    let hash_a_new = hash(&env, 2);
    let hash_b_old = hash(&env, 3);
    let hash_b_new = hash(&env, 4);

    let pid_a = client.propose_upgrade(&g1, &target_a, &hash_a_new, &hash_a_old, &String::from_str(&env, "A"));
    client.approve_upgrade(&pid_a, &g1);
    client.approve_upgrade(&pid_a, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid_a, &g1, &target_a, &hash_a_new);

    assert!(client.is_rollback_available(&target_a));
    assert!(!client.is_rollback_available(&target_b));

    let pid_b = client.propose_upgrade(&g1, &target_b, &hash_b_new, &hash_b_old, &String::from_str(&env, "B"));
    client.approve_upgrade(&pid_b, &g1);
    client.approve_upgrade(&pid_b, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid_b, &g1, &target_b, &hash_b_new);

    assert!(client.is_rollback_available(&target_a));
    assert!(client.is_rollback_available(&target_b));
    assert_eq!(client.get_rollback_wasm_hash(&target_a).unwrap(), hash_a_old);
    assert_eq!(client.get_rollback_wasm_hash(&target_b).unwrap(), hash_b_old);
}

#[test]
fn per_contract_timelock_override() {
    let (env, _admin, _g1, _g2, _g3, client) = setup();
    let target = Address::generate(&env);
    client.register_governed_contract(&target, &7200u64);
    assert_eq!(client.get_contract_timelock(&target), 7200);
    assert_eq!(client.get_timelock(), DEFAULT_TIMELOCK_SECONDS);
}

#[test]
fn second_open_proposal_for_same_target_is_invalidated() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let first = client.propose_upgrade(&g1, &target, &hash(&env, 2), &hash(&env, 1), &String::from_str(&env, "first"));
    let second = client.propose_upgrade(&g1, &target, &hash(&env, 3), &hash(&env, 1), &String::from_str(&env, "second"));

    assert_eq!(client.get_proposal(&first).state, ProposalState::Pending);
    assert_eq!(client.get_proposal(&second).state, ProposalState::Invalidated);

    client.approve_upgrade(&first, &g1);
    client.approve_upgrade(&first, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&first, &g1, &target, &hash(&env, 2));
    assert_eq!(client.get_proposal(&first).state, ProposalState::Executed);

    let result = client.try_execute_upgrade(&second, &g1, &target, &hash(&env, 3));
    assert!(result.is_err());
}

#[test]
fn batch_upgrade_all_or_nothing() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let a = register_target(&client, &env);
    let b = register_target(&client, &env);
    let targets = vec![&env, a.clone(), b.clone()];
    let new_hashes = vec![&env, hash(&env, 2), hash(&env, 4)];
    let old_hashes = vec![&env, hash(&env, 1), hash(&env, 3)];

    let pid = client.propose_batch_upgrade(
        &g1,
        &targets,
        &new_hashes,
        &old_hashes,
        &String::from_str(&env, "batch"),
    );
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_batch_upgrade(&pid, &g1);

    let batch = client.get_batch_proposal(&pid);
    assert_eq!(batch.state, ProposalState::Executed);
    assert!(client.is_rollback_available(&a));
    assert!(client.is_rollback_available(&b));
}

#[test]
fn batch_upgrade_failure_injects_no_partial_state() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let a = register_target(&client, &env);
    let b = Address::generate(&env); // not governed
    // Register both so propose succeeds, then unregister b before execute.
    client.register_governed_contract(&b, &0u64);

    let targets = vec![&env, a.clone(), b.clone()];
    let new_hashes = vec![&env, hash(&env, 2), hash(&env, 4)];
    let old_hashes = vec![&env, hash(&env, 1), hash(&env, 3)];
    let pid = client.propose_batch_upgrade(
        &g1,
        &targets,
        &new_hashes,
        &old_hashes,
        &String::from_str(&env, "batch"),
    );
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);

    client.unregister_governed_contract(&b);

    let result = client.try_execute_batch_upgrade(&pid, &g1);
    assert!(result.is_err());

    // Neither target received a rollback slot — nothing executed.
    assert!(!client.is_rollback_available(&a));
    assert!(!client.is_rollback_available(&b));
    assert_eq!(client.get_batch_proposal(&pid).state, ProposalState::Approved);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn propose_ungoverned_target_fails() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let target = Address::generate(&env);
    client.propose_upgrade(&g1, &target, &hash(&env, 2), &hash(&env, 1), &String::from_str(&env, "x"));
}

#[test]
fn execute_upgrade_rejects_wrong_target() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let other = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let pid = client.propose_upgrade(&g1, &target, &new_hash, &hash(&env, 1), &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);

    let result = client.try_execute_upgrade(&pid, &g1, &other, &new_hash);
    assert!(result.is_err());
}

#[test]
fn neg_propose_upgrade_unauthorized() {
    let (env, _admin, _g1, _g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let stranger = Address::generate(&env);
    let result = client.try_propose_upgrade(
        &stranger,
        &target,
        &hash(&env, 2),
        &hash(&env, 1),
        &String::from_str(&env, "x"),
    );
    assert!(result.is_err());
}

#[test]
fn neg_propose_upgrade_wrong_state() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    client.toggle_pause();
    let target = register_target(&client, &env);
    let result = client.try_propose_upgrade(
        &g1,
        &target,
        &hash(&env, 2),
        &hash(&env, 1),
        &String::from_str(&env, "x"),
    );
    assert!(result.is_err());
}

#[test]
fn neg_execute_upgrade_unauthorized() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let pid = client.propose_upgrade(&g1, &target, &new_hash, &hash(&env, 1), &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    let stranger = Address::generate(&env);
    let result = client.try_execute_upgrade(&pid, &stranger, &target, &new_hash);
    assert!(result.is_err());
}

#[test]
fn neg_execute_upgrade_wrong_state() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let pid = client.propose_upgrade(&g1, &target, &new_hash, &hash(&env, 1), &String::from_str(&env, "v2"));
    let result = client.try_execute_upgrade(&pid, &g1, &target, &new_hash);
    assert!(result.is_err());
}

#[test]
fn neg_propose_ungoverned_is_rejected() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let target = Address::generate(&env);
    let result = client.try_propose_upgrade(
        &g1, &target, &hash(&env, 1), &hash(&env, 0), &String::from_str(&env, "x"),
    );
    assert!(result.is_err());
}

#[test]
fn neg_register_governed_contract_wrong_state() {
    let (env, _admin, _g1, _g2, _g3, client) = setup();
    let target = Address::generate(&env);
    let result = client.try_register_governed_contract(&target, &1u64); // below 3600 and non-zero
    assert!(result.is_err());
}

#[test]
fn neg_execute_batch_upgrade_unauthorized() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let a = register_target(&client, &env);
    let b = register_target(&client, &env);
    let pid = client.propose_batch_upgrade(
        &g1,
        &vec![&env, a.clone(), b.clone()],
        &vec![&env, hash(&env, 2), hash(&env, 4)],
        &vec![&env, hash(&env, 1), hash(&env, 3)],
        &String::from_str(&env, "b"),
    );
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    let stranger = Address::generate(&env);
    let result = client.try_execute_batch_upgrade(&pid, &stranger);
    assert!(result.is_err());
}

#[test]
fn neg_execute_batch_upgrade_wrong_state() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let a = register_target(&client, &env);
    let pid = client.propose_batch_upgrade(
        &g1,
        &vec![&env, a.clone()],
        &vec![&env, hash(&env, 2)],
        &vec![&env, hash(&env, 1)],
        &String::from_str(&env, "b"),
    );
    let result = client.try_execute_batch_upgrade(&pid, &g1);
    assert!(result.is_err());
}

#[test]
fn neg_rollback_upgrade_unauthorized() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let old_hash = hash(&env, 1);
    let pid = client.propose_upgrade(&g1, &target, &new_hash, &old_hash, &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid, &g1, &target, &new_hash);
    let stranger = Address::generate(&env);
    let result = client.try_rollback_upgrade(&stranger, &target, &old_hash);
    assert!(result.is_err());
}

#[test]
fn neg_rollback_upgrade_wrong_state() {
    let (env, admin, _g1, _g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let result = client.try_rollback_upgrade(&admin, &target, &hash(&env, 1));
    assert!(result.is_err());
}

#[test]
fn neg_approve_upgrade_unauthorized() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let pid = client.propose_upgrade(&g1, &target, &hash(&env, 2), &hash(&env, 1), &String::from_str(&env, "v2"));
    let stranger = Address::generate(&env);
    let result = client.try_approve_upgrade(&pid, &stranger);
    assert!(result.is_err());
}

#[test]
fn neg_approve_upgrade_wrong_state() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let pid = client.propose_upgrade(&g1, &target, &hash(&env, 2), &hash(&env, 1), &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    let result = client.try_approve_upgrade(&pid, &g1);
    assert!(result.is_err());
}

#[test]
fn neg_cancel_proposal_wrong_state() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let new_hash = hash(&env, 2);
    let pid = client.propose_upgrade(&g1, &target, &new_hash, &hash(&env, 1), &String::from_str(&env, "v2"));
    client.approve_upgrade(&pid, &g1);
    client.approve_upgrade(&pid, &g2);
    env.ledger().set_timestamp(env.ledger().timestamp() + DEFAULT_TIMELOCK_SECONDS + 1);
    client.execute_upgrade(&pid, &g1, &target, &new_hash);
    let result = client.try_cancel_proposal(&pid);
    assert!(result.is_err());
}

#[test]
fn neg_set_guardians_wrong_state() {
    let (env, _admin, g1, g2, _g3, client) = setup();
    client.toggle_pause();
    let result = client.try_set_guardians(&vec![&env, g1.clone(), g2.clone()]);
    assert!(result.is_err());
}

#[test]
fn neg_set_timelock_wrong_state() {
    let (_env, _admin, _g1, _g2, _g3, client) = setup();
    let result = client.try_set_timelock(&1u64);
    assert!(result.is_err());
}

#[test]
fn neg_set_contract_timelock_wrong_state() {
    let (env, _admin, _g1, _g2, _g3, client) = setup();
    let target = register_target(&client, &env);
    let result = client.try_set_contract_timelock(&target, &10u64);
    assert!(result.is_err());
}

#[test]
fn neg_propose_batch_upgrade_unauthorized() {
    let (env, _admin, _g1, _g2, _g3, client) = setup();
    let a = register_target(&client, &env);
    let stranger = Address::generate(&env);
    let result = client.try_propose_batch_upgrade(
        &stranger,
        &vec![&env, a.clone()],
        &vec![&env, hash(&env, 2)],
        &vec![&env, hash(&env, 1)],
        &String::from_str(&env, "b"),
    );
    assert!(result.is_err());
}

#[test]
fn neg_propose_batch_upgrade_wrong_state() {
    let (env, _admin, g1, _g2, _g3, client) = setup();
    client.toggle_pause();
    let a = register_target(&client, &env);
    let result = client.try_propose_batch_upgrade(
        &g1,
        &vec![&env, a.clone()],
        &vec![&env, hash(&env, 2)],
        &vec![&env, hash(&env, 1)],
        &String::from_str(&env, "b"),
    );
    assert!(result.is_err());
}

#[test]
fn neg_unregister_governed_contract_wrong_state() {
    // Unregistering a never-registered target is a no-op on the flag; proposing
    // against it afterwards is the observable wrong-state/not-governed path.
    let (env, _admin, g1, _g2, _g3, client) = setup();
    let target = Address::generate(&env);
    client.unregister_governed_contract(&target);
    let result = client.try_propose_upgrade(
        &g1, &target, &hash(&env, 1), &hash(&env, 0), &String::from_str(&env, "x"),
    );
    assert!(result.is_err());
}

#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    let contract_id = env.register(ContractUpgradeGovernance, ());
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let g1 = Address::generate(&env);
    client.init(&admin, &vec![&env, g1.clone(), Address::generate(&env)]);
    let result = client.try_init(&admin, &vec![&env, g1, Address::generate(&env)]);
    assert!(result.is_err());
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    let contract_id = env.register(ContractUpgradeGovernance, ());
    let client = ContractUpgradeGovernanceClient::new(&env, &contract_id);
    let result = client.try_init(&Address::generate(&env), &vec![&env, Address::generate(&env)]);
    assert!(result.is_err());
}

#[test]
fn neg_get_guardians_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_get_guardians();
    assert!(result.is_err());
}

#[test]
fn neg_get_guardians_wrong_state() {
    neg_get_guardians_unauthorized();
}

#[test]
fn neg_get_guardian_count_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_get_guardian_count();
    assert!(result.is_err());
}

#[test]
fn neg_get_guardian_count_wrong_state() {
    neg_get_guardian_count_unauthorized();
}

#[test]
fn neg_set_guardians_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_set_guardians(&vec![&env, Address::generate(&env), Address::generate(&env)]);
    assert!(result.is_err());
}

#[test]
fn neg_unregister_governed_contract_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_unregister_governed_contract(&Address::generate(&env));
    assert!(result.is_err());
}

#[test]
fn neg_get_governed_contracts_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_get_governed_contracts();
    assert!(result.is_err());
}

#[test]
fn neg_get_governed_contracts_wrong_state() {
    neg_get_governed_contracts_unauthorized();
}

#[test]
fn neg_is_governed_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_is_governed(&Address::generate(&env));
    assert!(result.is_err());
}

#[test]
fn neg_is_governed_wrong_state() {
    neg_is_governed_unauthorized();
}

#[test]
fn neg_set_contract_timelock_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_set_contract_timelock(&Address::generate(&env), &3600u64);
    assert!(result.is_err());
}

#[test]
fn neg_get_contract_timelock_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_get_contract_timelock(&Address::generate(&env));
    assert!(result.is_err());
}

#[test]
fn neg_get_contract_timelock_wrong_state() {
    neg_get_contract_timelock_unauthorized();
}

#[test]
fn neg_get_timelock_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_get_timelock();
    assert!(result.is_err());
}

#[test]
fn neg_get_timelock_wrong_state() {
    neg_get_timelock_unauthorized();
}

#[test]
fn neg_toggle_pause_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_toggle_pause();
    assert!(result.is_err());
}

#[test]
fn neg_toggle_pause_wrong_state() {
    neg_toggle_pause_unauthorized();
}

#[test]
fn neg_is_paused_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_is_paused();
    assert!(result.is_err());
}

#[test]
fn neg_is_paused_wrong_state() {
    neg_is_paused_unauthorized();
}

#[test]
fn neg_get_proposal_unauthorized() {
    let (_env, _admin, _g1, _g2, _g3, client) = setup();
    let result = client.try_get_proposal(&99);
    assert!(result.is_err());
}

#[test]
fn neg_get_proposal_wrong_state() {
    neg_get_proposal_unauthorized();
}

#[test]
fn neg_get_batch_proposal_unauthorized() {
    let (_env, _admin, _g1, _g2, _g3, client) = setup();
    let result = client.try_get_batch_proposal(&99);
    assert!(result.is_err());
}

#[test]
fn neg_get_batch_proposal_wrong_state() {
    neg_get_batch_proposal_unauthorized();
}

#[test]
fn neg_get_proposal_count_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    assert_eq!(client.get_proposal_count(), 0);
}

#[test]
fn neg_get_proposal_count_wrong_state() {
    neg_get_proposal_count_unauthorized();
}

#[test]
fn neg_get_approved_by_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_get_approved_by(&1);
    assert!(result.is_err());
}

#[test]
fn neg_get_approved_by_wrong_state() {
    neg_get_approved_by_unauthorized();
}

#[test]
fn neg_get_admin_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_get_admin();
    assert!(result.is_err());
}

#[test]
fn neg_get_admin_wrong_state() {
    neg_get_admin_unauthorized();
}

#[test]
fn neg_get_rollback_wasm_hash_unauthorized() {
    let (env, _admin, _g1, _g2, _g3, client) = setup();
    assert!(client.get_rollback_wasm_hash(&Address::generate(&env)).is_none());
}

#[test]
fn neg_get_rollback_wasm_hash_wrong_state() {
    neg_get_rollback_wasm_hash_unauthorized();
}

#[test]
fn neg_is_rollback_available_unauthorized() {
    let (env, _admin, _g1, _g2, _g3, client) = setup();
    assert!(!client.is_rollback_available(&Address::generate(&env)));
}

#[test]
fn neg_is_rollback_available_wrong_state() {
    neg_is_rollback_available_unauthorized();
}

#[test]
fn neg_cancel_proposal_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_cancel_proposal(&1);
    assert!(result.is_err());
}

#[test]
fn neg_set_timelock_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_set_timelock(&7200u64);
    assert!(result.is_err());
}

#[test]
fn neg_register_governed_contract_unauthorized() {
    let env = Env::default();
    let client = ContractUpgradeGovernanceClient::new(&env, &env.register(ContractUpgradeGovernance, ()));
    let result = client.try_register_governed_contract(&Address::generate(&env), &0u64);
    assert!(result.is_err());
}
