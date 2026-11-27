#![cfg(test)]

extern crate alloc;

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::{Env, IntoVal};

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
    client.register(&admin, &agent);
    assert!(client.is_authorized(&agent));

    // Revoke
    client.revoke_agent(&admin, &agent);
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
    client.register(&admin, &agent);

    assert!(!client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));
    assert!(!client.has_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS)));

    // Grant Renewals + Approvals.
    let mask = ScopeSet(ScopeSet::RENEWALS | ScopeSet::APPROVALS);
    client.update_scopes(&admin, &agent, &mask);

    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));
    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::APPROVALS)));
    assert!(!client.has_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS)));
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
    let result = client.try_update_scopes(&admin, &agent, &ScopeSet(ScopeSet::RENEWALS));
    assert_eq!(result, Err(Ok(Error::NotRegistered)));
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
    client.register(&admin, &agent);
    client.update_scopes(&admin, &agent, &ScopeSet(ScopeSet::GIFTCARDS));

    // Should not panic.
    assert!(client
        .try_require_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS))
        .is_ok());
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
    client.register(&admin, &agent);
    client.update_scopes(&admin, &agent, &ScopeSet(ScopeSet::RENEWALS));

    let result = client.try_require_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS));
    assert_eq!(result, Err(Ok(Error::MissingScope)));
}

// ── Bug condition exploration tests ──────────────────────────────────────────

/// isBugCondition_Authorized: address has no storage entry.
#[test]
fn test_fault_condition_authorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unregistered_agent = Address::generate(&env);

    client.init(&admin);

    let result = client.try_require_authorized(&unregistered_agent);
    assert_eq!(result, Err(Ok(Error::NotRegistered)));
}

/// isBugCondition_Scope (bit not set): agent registered with Renewals, demand GiftCards.
#[test]
fn test_fault_condition_scope_missing_bit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&admin, &agent);
    client.update_scopes(&admin, &agent, &ScopeSet(ScopeSet::RENEWALS));

    let result = client.try_require_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS));
    assert_eq!(result, Err(Ok(Error::MissingScope)));
}

/// isBugCondition_Scope (stored_mask is None): completely unregistered agent.
#[test]
fn test_fault_condition_scope_unregistered() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unregistered_agent = Address::generate(&env);

    client.init(&admin);

    let result = client.try_require_scope(&unregistered_agent, &ScopeSet(ScopeSet::RENEWALS));
    assert_eq!(result, Err(Ok(Error::MissingScope)));
}

// ── Preservation tests ────────────────────────────────────────────────────────

/// NOT isBugCondition_Authorized: registered agent → require_authorized succeeds.
#[test]
fn test_preservation_authorized_ok() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&admin, &agent);

    let result = client.try_require_authorized(&agent);
    assert!(result.is_ok(), "require_authorized should succeed for a registered agent");
}

/// NOT isBugCondition_Scope: agent has the requested scope → require_scope succeeds.
#[test]
fn test_preservation_scope_ok() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&admin, &agent);
    client.update_scopes(&admin, &agent, &ScopeSet(ScopeSet::RENEWALS));

    let result = client.try_require_scope(&agent, &ScopeSet(ScopeSet::RENEWALS));
    assert!(result.is_ok(), "require_scope should succeed when the agent has the requested scope");
}

/// is_authorized returns the correct bool across the register → revoke lifecycle.
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
    client.register(&admin, &agent);
    assert!(client.is_authorized(&agent));

    // After revoke → false again.
    client.revoke_agent(&admin, &agent);
    assert!(!client.is_authorized(&agent));
}

/// has_scope returns the correct bool before and after update_scopes.
#[test]
fn test_preservation_has_scope() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&admin, &agent);

    assert!(!client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));
    assert!(!client.has_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS)));

    client.update_scopes(&admin, &agent, &ScopeSet(ScopeSet::RENEWALS));

    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));
    assert!(!client.has_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS)));
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

    client.transfer_admin(&new_admin);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_pending_admin(), Some(new_admin.clone()));

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
    client.register(&admin, &agent);
    assert!(client.is_authorized(&agent));

    client.transfer_admin(&new_admin);
    client.accept_admin();

    // New admin can emergency-revoke (admin-only path).
    client.emergency_revoke(&agent);
    assert!(!client.is_authorized(&agent));
}

// ── Additional ScopeSet logic tests ──────────────────────────────────────────

#[test]
fn test_scopeset_logic() {
    let s1 = ScopeSet(ScopeSet::RENEWALS);
    let s2 = ScopeSet(ScopeSet::GIFTCARDS);
    
    assert!(s1.is_valid());
    assert!(s2.is_valid());
    assert!(!ScopeSet(1 << 5).is_valid()); // Invalid bit

    let union_scope = s1.union(&s2);
    assert_eq!(union_scope.0, ScopeSet::RENEWALS | ScopeSet::GIFTCARDS);
    assert!(union_scope.contains(&s1));
    assert!(union_scope.contains(&s2));

    let diff = union_scope.difference(&s1);
    assert_eq!(diff.0, ScopeSet::GIFTCARDS);
}

#[test]
fn test_update_scopes_invalid() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    client.init(&admin);
    client.register(&admin, &agent);

    // Invalid scope bits
    let res = client.try_update_scopes(&admin, &agent, &ScopeSet(1 << 5));
    assert_eq!(res, Err(Ok(Error::InvalidScope)));
}

#[test]
fn test_require_scopes() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    client.init(&admin);
    client.register(&admin, &agent);

    let scope = ScopeSet(ScopeSet::RENEWALS | ScopeSet::GIFTCARDS);
    client.update_scopes(&admin, &agent, &scope);

    // Should succeed
    assert!(client.try_require_scopes(&agent, &scope).is_ok());
    assert!(client
        .try_require_scope(&agent, &ScopeSet(ScopeSet::RENEWALS))
        .is_ok());
}
// ── Authority expiry (issue #1656) ──────────────────────────────────────────

use soroban_sdk::testutils::Ledger as _;

fn expiry_setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let contract_id = env.register_contract(None, AgentRegistry);
    let admin = Address::generate(&env);
    let principal = Address::generate(&env);
    let agent = Address::generate(&env);
    AgentRegistryClient::new(&env, &contract_id).init(&admin);
    (env, contract_id, principal, agent)
}

#[test]
fn test_authority_valid_before_expiry_invalid_after() {
    let (env, contract_id, principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    client.register_with_expiry(&principal, &agent, &Some(2_000u64));
    client.update_scopes(&principal, &agent, &ScopeSet(ScopeSet::RENEWALS));
    assert_eq!(client.get_expiry(&agent), Some(2_000u64));

    // Before expiry: everything works.
    env.ledger().set_timestamp(1_999);
    assert!(client.is_authorized(&agent));
    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));
    assert!(client.try_require_authorized(&agent).is_ok());

    // At the expiry timestamp the authority is already gone (now >= expires_at).
    env.ledger().set_timestamp(2_000);
    assert!(!client.is_authorized(&agent));
    assert!(!client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));
    assert_eq!(
        client.try_require_authorized(&agent),
        Err(Ok(Error::AuthorityExpired))
    );
    assert_eq!(
        client.try_require_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)),
        Err(Ok(Error::AuthorityExpired))
    );

    // Long after expiry: still invalid.
    env.ledger().set_timestamp(10_000_000);
    assert!(!client.is_authorized(&agent));
}

#[test]
fn test_admin_can_extend_expiry() {
    let (env, contract_id, principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    client.register_with_expiry(&principal, &agent, &Some(2_000u64));
    client.update_scopes(&principal, &agent, &ScopeSet(ScopeSet::GIFTCARDS));

    // Extend before it lapses.
    env.ledger().set_timestamp(1_500);
    client.set_expiry(&agent, &Some(5_000u64));
    assert_eq!(client.get_expiry(&agent), Some(5_000u64));

    env.ledger().set_timestamp(3_000);
    assert!(client.is_authorized(&agent));
    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS)));

    // Let it lapse, then revive it: scopes are preserved.
    env.ledger().set_timestamp(6_000);
    assert!(!client.is_authorized(&agent));
    client.set_expiry(&agent, &Some(9_000u64));
    assert!(client.is_authorized(&agent));
    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::GIFTCARDS)));
}

#[test]
fn test_set_expiry_none_clears_expiry() {
    let (env, contract_id, principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    client.register_with_expiry(&principal, &agent, &Some(2_000u64));
    client.set_expiry(&agent, &None);
    assert_eq!(client.get_expiry(&agent), None);

    env.ledger().set_timestamp(1_000_000);
    assert!(client.is_authorized(&agent));
}

#[test]
fn test_expiry_must_be_in_the_future() {
    let (env, contract_id, principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    // now == 1_000, so 1_000 and 999 are both rejected.
    assert_eq!(
        client.try_register_with_expiry(&principal, &agent, &Some(1_000u64)),
        Err(Ok(Error::InvalidExpiry))
    );
    client.register(&principal, &agent);
    assert_eq!(
        client.try_set_expiry(&agent, &Some(999u64)),
        Err(Ok(Error::InvalidExpiry))
    );
}

#[test]
fn test_set_expiry_requires_registered_agent() {
    let (env, contract_id, _principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    assert_eq!(
        client.try_set_expiry(&agent, &Some(5_000u64)),
        Err(Ok(Error::NotRegistered))
    );
}

#[test]
fn test_set_expiry_emits_event() {
    let (env, contract_id, principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    client.register(&principal, &agent);
    client.set_expiry(&agent, &Some(5_000u64));
    assert!(!env.events().all().events().is_empty());
}

#[test]
fn test_register_with_expiry_emits_events() {
    let (env, contract_id, principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    client.register_with_expiry(&principal, &agent, &Some(5_000u64));
    // agent/reg + agent/exp_set
    assert!(env.events().all().events().len() >= 2);
}

#[test]
fn test_revoke_clears_expiry_and_reregister_starts_clean() {
    let (env, contract_id, principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    client.register_with_expiry(&principal, &agent, &Some(2_000u64));
    client.revoke_agent(&principal, &agent);
    assert_eq!(client.get_expiry(&agent), None);

    // Re-registering later must not inherit the old expiry.
    env.ledger().set_timestamp(3_000);
    client.register(&principal, &agent);
    assert!(client.is_authorized(&agent));
}

/// Migration check: an entry written BEFORE #1656 is a bare `u32` under
/// `DataKey::Agent` with no expiry key. It must keep working and never expire.
#[test]
fn test_legacy_entry_without_expiry_never_expires() {
    let (env, contract_id, _principal, agent) = expiry_setup();
    let client = AgentRegistryClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent.clone()), &ScopeSet::RENEWALS);
    });

    assert!(client.is_authorized(&agent));
    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));
    assert_eq!(client.get_expiry(&agent), None);

    env.ledger().set_timestamp(u64::MAX / 2);
    assert!(client.is_authorized(&agent));

    // An admin can retrofit an expiry onto the legacy entry.
    env.ledger().set_timestamp(1_000);
    client.set_expiry(&agent, &Some(2_000u64));
    env.ledger().set_timestamp(2_000);
    assert!(!client.is_authorized(&agent));
}

// ── Principal-owned agents (v3) ─────────────────────────────────────────────

use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
use soroban_sdk::xdr::{ContractEventBody, ScVal, ScSymbol};
use soroban_sdk::{TryFromVal, Val};

fn last_event_topics(env: &Env) -> alloc::vec::Vec<alloc::string::String> {
    let events = env.events().all();
    let event = events.events().last().expect("expected an event");
    match &event.body {
        ContractEventBody::V0(v0) => v0
            .topics
            .iter()
            .map(|t| match t {
                ScVal::Symbol(ScSymbol(s)) => {
                    alloc::string::String::from_utf8_lossy(s.as_slice()).into_owned()
                }
                other => alloc::format!("{:?}", other),
            })
            .collect(),
    }
}

fn last_event_data(env: &Env) -> Val {
    let events = env.events().all();
    let event = events.events().last().expect("expected an event");
    match &event.body {
        ContractEventBody::V0(v0) => Val::try_from_val(env, &v0.data).unwrap(),
    }
}

#[test]
fn test_principal_registers_scopes_and_revokes_without_admin() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let principal = Address::generate(&env);
    let agent = Address::generate(&env);

    // init has no auth requirement.
    client.init(&admin);

    // Only the principal is authorized — admin key is never mocked.
    env.mock_auths(&[MockAuth {
        address: &principal,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "register",
            args: (principal.clone(), agent.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.register(&principal, &agent);
    assert!(client.is_authorized(&agent));
    assert_eq!(client.get_principal(&agent), Some(principal.clone()));

    env.mock_auths(&[MockAuth {
        address: &principal,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "update_scopes",
            args: (
                principal.clone(),
                agent.clone(),
                ScopeSet(ScopeSet::RENEWALS),
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.update_scopes(&principal, &agent, &ScopeSet(ScopeSet::RENEWALS));
    assert!(client.has_scope(&agent, &ScopeSet(ScopeSet::RENEWALS)));

    env.mock_auths(&[MockAuth {
        address: &principal,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "revoke_agent",
            args: (principal.clone(), agent.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.revoke_agent(&principal, &agent);
    assert!(!client.is_authorized(&agent));
    assert_eq!(client.get_principal(&agent), None);
}

#[test]
fn test_principal_cannot_modify_another_principals_agent() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&owner, &agent);

    assert_eq!(
        client.try_update_scopes(&stranger, &agent, &ScopeSet(ScopeSet::GIFTCARDS)),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        client.try_revoke_agent(&stranger, &agent),
        Err(Ok(Error::Unauthorized))
    );
    // Owner still in control.
    assert!(client.is_authorized(&agent));
    assert_eq!(client.get_principal(&agent), Some(owner));
}

#[test]
fn test_register_update_revoke_events_include_principal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let principal = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&principal, &agent);
    assert_eq!(last_event_topics(&env).as_slice(), ["agent", "reg"]);
    let data = last_event_data(&env);
    let (ev_principal, ev_agent): (Address, Address) = data.into_val(&env);
    assert_eq!((ev_principal, ev_agent), (principal.clone(), agent.clone()));

    client.update_scopes(&principal, &agent, &ScopeSet(ScopeSet::APPROVALS));
    assert_eq!(last_event_topics(&env).as_slice(), ["agent", "scopes"]);
    let data = last_event_data(&env);
    let (ev_principal, ev_agent, mask): (Address, Address, u32) = data.into_val(&env);
    assert_eq!(ev_principal, principal);
    assert_eq!(ev_agent, agent);
    assert_eq!(mask, ScopeSet::APPROVALS);

    client.revoke_agent(&principal, &agent);
    assert_eq!(last_event_topics(&env).as_slice(), ["agent", "revoke"]);
    let data = last_event_data(&env);
    let (ev_principal, ev_agent): (Address, Address) = data.into_val(&env);
    assert_eq!((ev_principal, ev_agent), (principal, agent));
}

#[test]
fn test_admin_emergency_revoke_emits_distinct_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let principal = Address::generate(&env);
    let agent = Address::generate(&env);

    client.init(&admin);
    client.register(&principal, &agent);

    client.emergency_revoke(&agent);
    // events().all() only covers the last invocation — read before other calls.
    assert_eq!(last_event_topics(&env).as_slice(), ["agent", "em_rev"]);
    let data = last_event_data(&env);
    let (ev_principal, ev_agent): (Option<Address>, Address) = data.into_val(&env);
    assert_eq!(ev_principal, Some(principal));
    assert_eq!(ev_agent, agent);

    assert!(!client.is_authorized(&agent));
    assert_eq!(client.get_principal(&agent), None);
}
