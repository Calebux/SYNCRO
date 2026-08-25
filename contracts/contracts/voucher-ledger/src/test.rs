#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env};

fn setup() -> (Env, Address, Address, Address, VoucherLedgerContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register_contract(None, VoucherLedgerContract);
    let client = VoucherLedgerContractClient::new(&env, &contract_id);
    client.init(&admin);

    (env, admin, recipient, contract_id, client)
}

#[test]
fn mint_redeem_and_exhaust_balance() {
    let (env, _admin, recipient, _contract_id, client) = setup();

    let code = BytesN::from_array(&env, &[7u8; 32]);
    let voucher_id = client.mint_voucher(&recipient, &1000i128, &code);

    assert_eq!(client.balance(&voucher_id), 1000);

    client.redeem_voucher(&voucher_id, &recipient, &250i128);
    assert_eq!(client.balance(&voucher_id), 750);
    assert!(client.is_active(&voucher_id));

    client.redeem_voucher(&voucher_id, &recipient, &750i128);
    assert_eq!(client.balance(&voucher_id), 0);
    assert!(!client.is_active(&voucher_id));

    let voucher = client.get_voucher(&voucher_id);
    assert_eq!(voucher.state, VoucherState::Redeemed);
}

#[test]
fn void_blocks_future_redemption() {
    let (env, _admin, recipient, _contract_id, client) = setup();

    let code = BytesN::from_array(&env, &[9u8; 32]);
    let voucher_id = client.mint_voucher(&recipient, &500i128, &code);

    client.void_voucher(&voucher_id);
    assert_eq!(client.balance(&voucher_id), 0);
    assert!(!client.is_active(&voucher_id));

    assert!(client
        .try_redeem_voucher(&voucher_id, &recipient, &1i128)
        .is_err());
}

#[test]
fn duplicate_code_is_rejected() {
    let (env, _admin, recipient, _contract_id, client) = setup();

    let code = BytesN::from_array(&env, &[11u8; 32]);
    client.mint_voucher(&recipient, &100i128, &code);
    assert!(client
        .try_mint_voucher(&recipient, &100i128, &code)
        .is_err());
}
