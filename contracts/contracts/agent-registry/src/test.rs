#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

#[test]
fn test_registration_and_revocation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    // Init
    client.init(&admin);

    // Check not authorized initially
    assert!(!client.is_authorized(&agent));

    // Register
    client.register(&agent, &0);
    assert!(client.is_authorized(&agent));

    // Revoke
    client.revoke_agent(&agent);
    assert!(!client.is_authorized(&agent));
    assert!(!client.has_scope(&agent, &Scope::Renewals));
}

#[test]
#[should_panic(expected = "agent not authorized")]
fn test_require_authorized_panics() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let agent = Address::generate(&env);
    client.require_authorized(&agent);
}

#[test]
fn test_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    let result = client.try_init(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_get_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    assert_eq!(client.get_admin(), admin);
    assert!(client.get_pending_admin().is_none());
}

// ── Scope handling ──────────────────────────────────────────────────────────

#[test]
fn test_register_then_grant_and_check_scopes() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent, &0);

    // A freshly registered agent starts with NO scopes. This exercises the fix
    // for the previous type mismatch (register stored a bool, has_scope read a
    // u32) — reading the scope mask must not panic and must return false.
    assert!(!client.has_scope(&agent, &Scope::Renewals));
    assert!(!client.has_scope(&agent, &Scope::GiftCards));

    // Grant Renewals + Approvals.
    let mask = Scope::Renewals as u32 | Scope::Approvals as u32;
    client.update_scopes(&agent, &mask);

    assert!(client.has_scope(&agent, &Scope::Renewals));
    assert!(client.has_scope(&agent, &Scope::Approvals));
    assert!(!client.has_scope(&agent, &Scope::GiftCards));
}

#[test]
fn test_update_scopes_requires_registered_agent() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);

    // Updating scopes for an unregistered agent is rejected.
    let result = client.try_update_scopes(&agent, &(Scope::Renewals as u32));
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_require_scope_succeeds_with_scope() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent, &0);
    client.update_scopes(&agent, &(Scope::GiftCards as u32));

    // Should not panic.
    client.require_scope(&agent, &Scope::GiftCards);
}

#[test]
#[should_panic(expected = "agent missing required scope")]
fn test_require_scope_panics_without_scope() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent, &0);
    // Grant only Renewals, then demand GiftCards.
    client.update_scopes(&agent, &(Scope::Renewals as u32));

    client.require_scope(&agent, &Scope::GiftCards);
}

// ── Two-step admin transfer ───────────────────────────────────────────────────

#[test]
fn test_two_step_admin_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    client.init(&admin);

    // Step 1: nominate. Admin is unchanged until acceptance.
    client.transfer_admin(&new_admin);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_pending_admin(), Some(new_admin.clone()));

    // Step 2: nominee accepts and becomes admin.
    client.accept_admin();
    assert_eq!(client.get_admin(), new_admin);
    assert!(client.get_pending_admin().is_none());
}

#[test]
fn test_cancel_admin_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    client.init(&admin);
    client.transfer_admin(&new_admin);
    assert_eq!(client.get_pending_admin(), Some(new_admin));

    client.cancel_transfer_admin();
    assert!(client.get_pending_admin().is_none());
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_accept_admin_without_pending_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    let result = client.try_accept_admin();
    assert_eq!(result, Err(Ok(Error::NoPendingAdmin)));
}

#[test]
fn test_new_admin_can_administer_after_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.transfer_admin(&new_admin);
    client.accept_admin();

    // The new admin can perform privileged operations.
    client.register(&agent, &0);
    assert!(client.is_authorized(&agent));
}
