#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, BytesN, Env};
use super::*;

fn test_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}


#[test]
fn neg_init_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_mint_voucher_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    let _ = client.try_mint_voucher(&Address::generate(&env), &1i128, &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_mint_voucher_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_mint_voucher(&Address::generate(&env), &1i128, &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_redeem_voucher_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    let _ = client.try_redeem_voucher(&1u64, &Address::generate(&env), &1i128);
}

#[test]
fn neg_redeem_voucher_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_redeem_voucher(&1u64, &Address::generate(&env), &1i128);
}

#[test]
fn neg_void_voucher_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    let _ = client.try_void_voucher(&1u64);
}

#[test]
fn neg_void_voucher_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_void_voucher(&1u64);
}

#[test]
fn neg_get_voucher_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    let _ = client.try_get_voucher(&1u64);
}

#[test]
fn neg_get_voucher_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_voucher(&1u64);
}

#[test]
fn neg_balance_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    let _ = client.try_balance(&1u64);
}

#[test]
fn neg_balance_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_balance(&1u64);
}

#[test]
fn neg_is_active_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    let _ = client.try_is_active(&1u64);
}

#[test]
fn neg_is_active_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VoucherLedgerContract, ());
    let client = VoucherLedgerContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_active(&1u64);
}

