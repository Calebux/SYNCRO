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
    client.register(&agent);
    assert!(client.is_authorized(&agent));

    // Revoke
    client.revoke_agent(&agent);
    assert!(!client.is_authorized(&agent));
}

#[test]
fn test_require_authorized_not_registered() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    client.init(&admin);

    let result = client.try_require_authorized(&agent);
    assert_eq!(result, Err(Ok(Error::NotRegistered)));
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
    client.register(&agent);

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
    client.register(&agent);
    client.update_scopes(&agent, &(Scope::GiftCards as u32));

    // Should not panic.
    client.require_scope(&agent, &Scope::GiftCards);
}

#[test]
fn test_require_scope_missing_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent);
    client.update_scopes(&agent, &(Scope::Renewals as u32));

    let result = client.try_require_scope(&agent, &Scope::GiftCards);
    assert_eq!(result, Err(Ok(Error::MissingScope)));
}

// ── Bug condition exploration tests ──────────────────────────────────────────
// These three tests MUST FAIL on unfixed code — failure confirms the bug exists.
// The unfixed require_authorized / require_scope call panic!() instead of
// returning a typed Result, so try_* calls return a host error, not the
// expected Err(Ok(Error::*)) variant.

/// isBugCondition_Authorized: address has no storage entry — unfixed code panics.
///
/// Validates: Requirements 1.1, 1.3
#[test]
fn test_fault_condition_authorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unregistered_agent = Address::generate(&env);

    client.init(&admin);

    // On unfixed code this returns a host panic error, not Err(Ok(Error::NotRegistered)).
    let result = client.try_require_authorized(&unregistered_agent);
    assert_eq!(result, Err(Ok(Error::NotRegistered)));
}

/// isBugCondition_Scope (bit not set): agent registered with Renewals, demand GiftCards.
///
/// Validates: Requirements 1.2, 1.3
#[test]
fn test_fault_condition_scope_missing_bit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent);
    client.update_scopes(&agent, &(Scope::Renewals as u32));

    // On unfixed code this returns a host panic error, not Err(Ok(Error::MissingScope)).
    let result = client.try_require_scope(&agent, &Scope::GiftCards);
    assert_eq!(result, Err(Ok(Error::MissingScope)));
}

/// isBugCondition_Scope (stored_mask is None): completely unregistered agent.
///
/// Validates: Requirements 1.2, 1.3
#[test]
fn test_fault_condition_scope_unregistered() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unregistered_agent = Address::generate(&env);

    client.init(&admin);

    // On unfixed code this returns a host panic error, not Err(Ok(Error::MissingScope)).
    let result = client.try_require_scope(&unregistered_agent, &Scope::Renewals);
    assert_eq!(result, Err(Ok(Error::MissingScope)));
}

// ── Preservation tests ────────────────────────────────────────────────────────
// These tests verify the Ok-path and bool-helper behavior that must not change
// before or after the fix.  They MUST PASS on unfixed code.

/// NOT isBugCondition_Authorized: registered agent → require_authorized succeeds.
///
/// Validates: Requirements 3.1
#[test]
fn test_preservation_authorized_ok() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent);

    // The ok path must not panic on either unfixed or fixed code.
    // try_require_authorized return type depends on the function signature:
    //   - unfixed (returns ())         → Ok(())
    //   - fixed   (returns Result<…>)  → Ok(Ok(()))
    // We therefore assert via try_* and check only that no error occurred.
    let result = client.try_require_authorized(&agent);
    assert!(result.is_ok(), "require_authorized should succeed for a registered agent");
}

/// NOT isBugCondition_Scope: agent has the requested scope → require_scope succeeds.
///
/// Validates: Requirements 3.2
#[test]
fn test_preservation_scope_ok() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent);
    client.update_scopes(&agent, &(Scope::Renewals as u32));

    // The ok path must not panic on either unfixed or fixed code.
    // try_require_scope return type depends on the function signature:
    //   - unfixed (returns ())         → Ok(())
    //   - fixed   (returns Result<…>)  → Ok(Ok(()))
    // We therefore assert via try_* and check only that no error occurred.
    let result = client.try_require_scope(&agent, &Scope::Renewals);
    assert!(result.is_ok(), "require_scope should succeed when the agent has the requested scope");
}

/// is_authorized returns the correct bool across the register → revoke lifecycle.
///
/// Validates: Requirements 3.3
#[test]
fn test_preservation_is_authorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);

    // Unregistered → false.
    assert!(!client.is_authorized(&agent));

    // After register → true.
    client.register(&agent);
    assert!(client.is_authorized(&agent));

    // After revoke → false again.
    client.revoke_agent(&agent);
    assert!(!client.is_authorized(&agent));
}

/// has_scope returns the correct bool before and after update_scopes.
///
/// Validates: Requirements 3.4
#[test]
fn test_preservation_has_scope() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&agent);

    // Freshly registered agent has no scopes.
    assert!(!client.has_scope(&agent, &Scope::Renewals));
    assert!(!client.has_scope(&agent, &Scope::GiftCards));

    // Grant Renewals only.
    client.update_scopes(&agent, &(Scope::Renewals as u32));

    // Renewals bit is set; GiftCards bit is not.
    assert!(client.has_scope(&agent, &Scope::Renewals));
    assert!(!client.has_scope(&agent, &Scope::GiftCards));
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
    client.register(&agent);
    assert!(client.is_authorized(&agent));
}
