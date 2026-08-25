#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

// ── Mock Pausable Contract ──────────────────────────────────────────────────────

/// A mock contract that implements the pausable interface for testing
#[contract]
pub struct MockPausableContract;

#[contractimpl]
impl MockPausableContract {
    pub fn set_paused(_env: Env, _paused: bool) {
        // Mock implementation - just returns successfully
    }

    pub fn is_paused(_env: Env) -> bool {
        false
    }
}

// ── Test Helpers ────────────────────────────────────────────────────────────────

fn create_guardian_contract<'a>(env: &Env) -> (GuardianContractClient<'a>, Address) {
    let guardian_addr = Address::generate(env);
    let contract_id = env.register_contract(None, GuardianContract);
    let client = GuardianContractClient::new(env, &contract_id);
    (client, guardian_addr)
}

fn create_mock_contract(env: &Env) -> Address {
    env.register_contract(None, MockPausableContract)
}

// ── Initialization Tests ────────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);

    client.initialize(&guardian);

    assert_eq!(client.get_guardian(), guardian);
    assert_eq!(client.get_contract_count(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);

    client.initialize(&guardian);
    client.initialize(&guardian); // Should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_operations_before_init_fail() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, GuardianContract);
    let client = GuardianContractClient::new(&env, &contract_id);

    client.get_guardian(); // Should panic - not initialized
}

// ── Registration Tests ──────────────────────────────────────────────────────────

#[test]
fn test_register_contract_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    let name = String::from_str(&env, "TestContract");

    client.register_contract(&mock_contract, &name);

    assert_eq!(client.get_contract_count(), 1);
    assert!(client.is_contract_registered(&mock_contract));

    let contracts = client.get_registered_contracts();
    assert_eq!(contracts.len(), 1);
    
    let registered = contracts.get(0).unwrap();
    assert_eq!(registered.address, mock_contract);
    assert_eq!(registered.name, name);
    assert_eq!(registered.paused, false);
}

#[test]
fn test_register_multiple_contracts() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let contract1 = create_mock_contract(&env);
    let contract2 = create_mock_contract(&env);
    let contract3 = create_mock_contract(&env);

    client.register_contract(&contract1, &String::from_str(&env, "Contract1"));
    client.register_contract(&contract2, &String::from_str(&env, "Contract2"));
    client.register_contract(&contract3, &String::from_str(&env, "Contract3"));

    assert_eq!(client.get_contract_count(), 3);
    assert!(client.is_contract_registered(&contract1));
    assert!(client.is_contract_registered(&contract2));
    assert!(client.is_contract_registered(&contract3));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_register_duplicate_contract_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    let name = String::from_str(&env, "TestContract");

    client.register_contract(&mock_contract, &name);
    client.register_contract(&mock_contract, &name); // Should panic
}

#[test]
fn test_unregister_contract_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    client.register_contract(&mock_contract, &String::from_str(&env, "TestContract"));

    assert_eq!(client.get_contract_count(), 1);

    client.unregister_contract(&mock_contract);

    assert_eq!(client.get_contract_count(), 0);
    assert!(!client.is_contract_registered(&mock_contract));
}

#[test]
fn test_unregister_one_of_many() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let contract1 = create_mock_contract(&env);
    let contract2 = create_mock_contract(&env);
    let contract3 = create_mock_contract(&env);

    client.register_contract(&contract1, &String::from_str(&env, "Contract1"));
    client.register_contract(&contract2, &String::from_str(&env, "Contract2"));
    client.register_contract(&contract3, &String::from_str(&env, "Contract3"));

    client.unregister_contract(&contract2);

    assert_eq!(client.get_contract_count(), 2);
    assert!(client.is_contract_registered(&contract1));
    assert!(!client.is_contract_registered(&contract2));
    assert!(client.is_contract_registered(&contract3));
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_unregister_nonexistent_contract_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    client.unregister_contract(&mock_contract); // Should panic - not registered
}

// ── Emergency Pause/Unpause Tests ───────────────────────────────────────────────

#[test]
fn test_emergency_pause_all_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let contract1 = create_mock_contract(&env);
    let contract2 = create_mock_contract(&env);

    client.register_contract(&contract1, &String::from_str(&env, "Contract1"));
    client.register_contract(&contract2, &String::from_str(&env, "Contract2"));

    let paused_count = client.emergency_pause_all();

    assert_eq!(paused_count, 2);

    let contracts = client.get_registered_contracts();
    assert!(contracts.get(0).unwrap().paused);
    assert!(contracts.get(1).unwrap().paused);
}

#[test]
fn test_emergency_unpause_all_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let contract1 = create_mock_contract(&env);
    let contract2 = create_mock_contract(&env);

    client.register_contract(&contract1, &String::from_str(&env, "Contract1"));
    client.register_contract(&contract2, &String::from_str(&env, "Contract2"));

    client.emergency_pause_all();
    let unpaused_count = client.emergency_unpause_all();

    assert_eq!(unpaused_count, 2);

    let contracts = client.get_registered_contracts();
    assert!(!contracts.get(0).unwrap().paused);
    assert!(!contracts.get(1).unwrap().paused);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_emergency_pause_with_no_contracts_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    client.emergency_pause_all(); // Should panic - no contracts registered
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_emergency_unpause_with_no_contracts_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    client.emergency_unpause_all(); // Should panic - no contracts registered
}

// ── Authorization Tests ─────────────────────────────────────────────────────────

#[test]
fn test_only_guardian_can_register() {
    let env = Env::default();

    let (client, guardian) = create_guardian_contract(&env);
    env.mock_all_auths_allowing_non_root_auth();

    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    
    // Mock auth for guardian
    env.mock_all_auths();
    client.register_contract(&mock_contract, &String::from_str(&env, "Test"));

    assert!(client.is_contract_registered(&mock_contract));
}

#[test]
fn test_only_guardian_can_unregister() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    client.register_contract(&mock_contract, &String::from_str(&env, "Test"));

    client.unregister_contract(&mock_contract);
    assert!(!client.is_contract_registered(&mock_contract));
}

#[test]
fn test_only_guardian_can_emergency_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    client.register_contract(&mock_contract, &String::from_str(&env, "Test"));

    let paused = client.emergency_pause_all();
    assert_eq!(paused, 1);
}

// ── Query Tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_is_contract_registered_false_for_unregistered() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    assert!(!client.is_contract_registered(&mock_contract));
}

#[test]
fn test_get_registered_contracts_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let contracts = client.get_registered_contracts();
    assert_eq!(contracts.len(), 0);
}

#[test]
fn test_contract_metadata_stored_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    let name = String::from_str(&env, "MyContract");

    // Get timestamp before registration
    let before_time = env.ledger().timestamp();

    client.register_contract(&mock_contract, &name);

    let contracts = client.get_registered_contracts();
    let registered = contracts.get(0).unwrap();

    assert_eq!(registered.address, mock_contract);
    assert_eq!(registered.name, name);
    assert_eq!(registered.paused, false);
    assert!(registered.registered_at >= before_time);
}

// ── Integration Test ────────────────────────────────────────────────────────────

#[test]
fn test_full_incident_response_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    // Setup: Register multiple contracts
    let contract1 = create_mock_contract(&env);
    let contract2 = create_mock_contract(&env);
    let contract3 = create_mock_contract(&env);

    client.register_contract(&contract1, &String::from_str(&env, "SubscriptionRenewal"));
    client.register_contract(&contract2, &String::from_str(&env, "Allowance"));
    client.register_contract(&contract3, &String::from_str(&env, "Escrow"));

    assert_eq!(client.get_contract_count(), 3);

    // Incident detected - emergency pause all
    let paused = client.emergency_pause_all();
    assert_eq!(paused, 3);

    // Verify all contracts are marked as paused
    let contracts = client.get_registered_contracts();
    for i in 0..contracts.len() {
        assert!(contracts.get(i).unwrap().paused);
    }

    // Incident resolved - unpause all
    let unpaused = client.emergency_unpause_all();
    assert_eq!(unpaused, 3);

    // Verify all contracts are unpaused
    let contracts = client.get_registered_contracts();
    for i in 0..contracts.len() {
        assert!(!contracts.get(i).unwrap().paused);
    }
}

#[test]
fn test_register_after_unregister() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, guardian) = create_guardian_contract(&env);
    client.initialize(&guardian);

    let mock_contract = create_mock_contract(&env);
    let name = String::from_str(&env, "TestContract");

    // Register, unregister, then register again
    client.register_contract(&mock_contract, &name);
    assert!(client.is_contract_registered(&mock_contract));

    client.unregister_contract(&mock_contract);
    assert!(!client.is_contract_registered(&mock_contract));

    client.register_contract(&mock_contract, &name);
    assert!(client.is_contract_registered(&mock_contract));
    assert_eq!(client.get_contract_count(), 1);
}
