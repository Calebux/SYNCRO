#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String,
};

use super::{
    ChargeRecord, DisputeRecord, DisputeStatus, RefundError, SubscriptionRefundContract,
    SubscriptionRefundContractClient,
};

fn setup_env() -> (
    Env,
    Address,
    SubscriptionRefundContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SubscriptionRefundContract, ());
    let client = SubscriptionRefundContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let dispute_admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let merchant = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = token_contract.address();

    client.init(&admin, &dispute_admin);

    (
        env,
        contract_id,
        client,
        admin,
        dispute_admin,
        payer,
        merchant,
        token_id,
    )
}

#[test]
fn test_init_and_record_charge() {
    let (env, _id, client, _admin, _dispute_admin, payer, merchant, token_id) = setup_env();

    let payment_ref = 1001;
    let sub_id = 50;
    let amount = 500i128;

    client.record_charge(
        &payment_ref,
        &sub_id,
        &payer,
        &merchant,
        &token_id,
        &amount,
    );

    let charge: ChargeRecord = client.get_charge(&payment_ref);
    assert_eq!(charge.payment_ref, payment_ref);
    assert_eq!(charge.sub_id, sub_id);
    assert_eq!(charge.payer, payer);
    assert_eq!(charge.merchant, merchant);
    assert_eq!(charge.token, token_id);
    assert_eq!(charge.amount, amount);
    assert!(!charge.refunded);
    assert!(!client.is_refunded(&payment_ref));
}

#[test]
fn test_direct_merchant_refund() {
    let (env, _id, client, _admin, _dispute_admin, payer, merchant, token_id) = setup_env();

    let token_sac = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    token_sac.mint(&merchant, &1000);
    assert_eq!(token_client.balance(&merchant), 1000);
    assert_eq!(token_client.balance(&payer), 0);

    let payment_ref = 1002;
    let sub_id = 51;
    let amount = 300i128;

    client.record_charge(
        &payment_ref,
        &sub_id,
        &payer,
        &merchant,
        &token_id,
        &amount,
    );

    client.process_refund(&payment_ref);

    assert!(client.is_refunded(&payment_ref));
    assert_eq!(token_client.balance(&merchant), 700);
    assert_eq!(token_client.balance(&payer), 300);
}

#[test]
fn test_dispute_authorization_and_refund_flow() {
    let (env, _id, client, _admin, _dispute_admin, payer, merchant, token_id) = setup_env();

    let token_sac = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    token_sac.mint(&merchant, &2000);

    let payment_ref = 1003;
    let sub_id = 52;
    let amount = 1000i128;

    client.record_charge(
        &payment_ref,
        &sub_id,
        &payer,
        &merchant,
        &token_id,
        &amount,
    );

    let reason = String::from_str(&env, "Service not delivered");
    client.open_dispute(&payment_ref, &reason);

    let dispute: DisputeRecord = client.get_dispute(&payment_ref);
    assert_eq!(dispute.status, DisputeStatus::Pending);

    // Authorize dispute
    client.authorize_dispute(&payment_ref, &true);
    let dispute_after_auth = client.get_dispute(&payment_ref);
    assert_eq!(dispute_after_auth.status, DisputeStatus::Approved);

    // Execute refund
    client.process_refund(&payment_ref);

    assert!(client.is_refunded(&payment_ref));
    assert_eq!(token_client.balance(&payer), 1000);
    assert_eq!(token_client.balance(&merchant), 1000);

    let dispute_resolved = client.get_dispute(&payment_ref);
    assert_eq!(dispute_resolved.status, DisputeStatus::Resolved);
}

#[test]
#[should_panic(expected = "AlreadyRefunded")]
fn test_double_refund_prevention() {
    let (env, _id, client, _admin, _dispute_admin, payer, merchant, token_id) = setup_env();

    let token_sac = token::StellarAssetClient::new(&env, &token_id);
    token_sac.mint(&merchant, &2000);

    let payment_ref = 1004;
    let sub_id = 53;
    let amount = 500i128;

    client.record_charge(
        &payment_ref,
        &sub_id,
        &payer,
        &merchant,
        &token_id,
        &amount,
    );

    // First refund succeeds
    client.process_refund(&payment_ref);
    assert!(client.is_refunded(&payment_ref));

    // Second refund attempt MUST panic with AlreadyRefunded
    client.process_refund(&payment_ref);
}

#[test]
#[should_panic(expected = "AlreadyRefunded")]
fn test_dispute_cannot_be_opened_on_refunded_charge() {
    let (env, _id, client, _admin, _dispute_admin, payer, merchant, token_id) = setup_env();

    let token_sac = token::StellarAssetClient::new(&env, &token_id);
    token_sac.mint(&merchant, &1000);

    let payment_ref = 1005;
    let sub_id = 54;
    let amount = 200i128;

    client.record_charge(
        &payment_ref,
        &sub_id,
        &payer,
        &merchant,
        &token_id,
        &amount,
    );

    client.process_refund(&payment_ref);

    let reason = String::from_str(&env, "Duplicate claim");
    client.open_dispute(&payment_ref, &reason);
}

#[test]
#[should_panic(expected = "ContractPaused")]
fn test_paused_contract_blocks_recording() {
    let (_env, _id, client, _admin, _dispute_admin, payer, merchant, token_id) = setup_env();

    client.set_paused(&true);

    client.record_charge(&1006, &55, &payer, &merchant, &token_id, &100);
}

#[test]
fn test_dispute_rejection_prevents_authorized_refund() {
    let (env, _id, client, _admin, _dispute_admin, payer, merchant, token_id) = setup_env();

    let payment_ref = 1007;
    client.record_charge(&payment_ref, &56, &payer, &merchant, &token_id, &100);

    let reason = String::from_str(&env, "Invalid reason");
    client.open_dispute(&payment_ref, &reason);

    // Dispute Admin rejects dispute
    client.authorize_dispute(&payment_ref, &false);

    let dispute = client.get_dispute(&payment_ref);
    assert_eq!(dispute.status, DisputeStatus::Rejected);
}
