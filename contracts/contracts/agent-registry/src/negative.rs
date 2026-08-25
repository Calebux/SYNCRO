#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_get_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_get_admin();
}

#[test]
fn neg_get_admin_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_admin();
}

#[test]
fn neg_get_pending_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_get_pending_admin();
}

#[test]
fn neg_get_pending_admin_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_pending_admin();
}

#[test]
fn neg_transfer_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_transfer_admin(&Address::generate(&env));
}

#[test]
fn neg_transfer_admin_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_transfer_admin(&Address::generate(&env));
}

#[test]
fn neg_cancel_transfer_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_cancel_transfer_admin();
}

#[test]
fn neg_cancel_transfer_admin_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_cancel_transfer_admin();
}

#[test]
fn neg_accept_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_accept_admin();
}

#[test]
fn neg_accept_admin_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_accept_admin();
}

#[test]
fn neg_register_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_register(&Address::generate(&env));
}

#[test]
fn neg_register_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_register(&Address::generate(&env));
}

#[test]
fn neg_update_scopes_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_update_scopes(&Address::generate(&env), &1u32);
}

#[test]
fn neg_update_scopes_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_update_scopes(&Address::generate(&env), &1u32);
}

#[test]
fn neg_revoke_agent_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_revoke_agent(&Address::generate(&env));
}

#[test]
fn neg_revoke_agent_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_revoke_agent(&Address::generate(&env));
}

#[test]
fn neg_is_authorized_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_is_authorized(&Address::generate(&env));
}

#[test]
fn neg_is_authorized_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_authorized(&Address::generate(&env));
}

#[test]
fn neg_require_authorized_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_require_authorized(&Address::generate(&env));
}

#[test]
fn neg_require_authorized_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_require_authorized(&Address::generate(&env));
}

#[test]
fn neg_has_scope_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_has_scope(&Address::generate(&env), &Scope::Renewals);
}

#[test]
fn neg_has_scope_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_has_scope(&Address::generate(&env), &Scope::Renewals);
}

#[test]
fn neg_require_scope_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    let _ = client.try_require_scope(&Address::generate(&env), &Scope::Renewals);
}

#[test]
fn neg_require_scope_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_require_scope(&Address::generate(&env), &Scope::Renewals);
}

