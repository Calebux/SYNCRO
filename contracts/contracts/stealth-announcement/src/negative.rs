#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_get_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    let _ = client.try_get_admin();
}

#[test]
fn neg_get_admin_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_admin();
}

#[test]
fn neg_publish_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    let _ = client.try_publish(&Bytes::from_slice(&env, b"x"), &1u32);
}

#[test]
fn neg_publish_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_publish(&Bytes::from_slice(&env, b"x"), &1u32);
}

#[test]
fn neg_get_announcement_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    let _ = client.try_get_announcement(&1u64);
}

#[test]
fn neg_get_announcement_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_announcement(&1u64);
}

#[test]
fn neg_get_announcement_count_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    let _ = client.try_get_announcement_count();
}

#[test]
fn neg_get_announcement_count_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_announcement_count();
}

#[test]
fn neg_get_announcements_range_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    let _ = client.try_get_announcements_range(&1u64, &1u64);
}

#[test]
fn neg_get_announcements_range_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_announcements_range(&1u64, &1u64);
}

#[test]
fn neg_get_latest_announcements_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    let _ = client.try_get_latest_announcements(&1u64);
}

#[test]
fn neg_get_latest_announcements_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( StealthAnnouncementContract, ());
    let client = StealthAnnouncementContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_latest_announcements(&1u64);
}

