#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

struct Ctx {
    env: Env,
    admin: Address,
    payer: Address,
    merchant: Address,
    token: Address,
    token_client: TokenClient<'static>,
    contract_id: Address,
    client: PaymentAdapterContractClient<'static>,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_client = TokenClient::new(&env, &token);
    StellarAssetClient::new(&env, &token).mint(&payer, &1_000_000_000i128);

    let contract_id = env.register_contract(None, PaymentAdapterContract);
    let client = PaymentAdapterContractClient::new(&env, &contract_id);
    client.init(&admin);

    token_client.approve(&payer, &contract_id, &1_000_000_000i128, &1_000_000u32);

    Ctx {
        env,
        admin,
        payer,
        merchant,
        token,
        token_client,
        contract_id,
        client,
    }
}

#[test]
fn allowlist_and_settle_with_decimals_awareness() {
    let ctx = setup();
    let decimals = ctx.token_client.decimals();

    ctx.client.allow_token(&ctx.token, &100);
    assert!(ctx.client.is_allowed(&ctx.token));

    let transferred_raw = ctx
        .client
        .settle_renewal(&ctx.payer, &ctx.merchant, &ctx.token, &5);

    let factor = 10i128.pow(decimals);
    assert_eq!(transferred_raw, 5 * factor);
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 5 * factor);
    assert_eq!(ctx.client.available(&ctx.token), 95);

    let policy = ctx.client.get_policy(&ctx.token);
    assert_eq!(policy.decimals, decimals);
    assert_eq!(policy.settled_display_units, 5);
}

#[test]
fn cap_exceeded_and_revocation_are_enforced() {
    let ctx = setup();

    ctx.client.allow_token(&ctx.token, &10);
    ctx.client
        .settle_renewal(&ctx.payer, &ctx.merchant, &ctx.token, &10);

    assert_eq!(ctx.client.available(&ctx.token), 0);

    assert!(ctx
        .client
        .try_settle_renewal(&ctx.payer, &ctx.merchant, &ctx.token, &1)
        .is_err());

    ctx.client.revoke_token(&ctx.token);
    assert!(!ctx.client.is_allowed(&ctx.token));

    assert!(ctx
        .client
        .try_settle_renewal(&ctx.payer, &ctx.merchant, &ctx.token, &1)
        .is_err());
}

#[test]
fn non_allowlisted_token_is_rejected() {
    let ctx = setup();
    let other_sac = ctx.env.register_stellar_asset_contract_v2(ctx.admin.clone());
    let other_token = other_sac.address();

    assert!(ctx
        .client
        .try_settle_renewal(&ctx.payer, &ctx.merchant, &other_token, &1)
        .is_err());
    assert_eq!(ctx.client.available(&other_token), 0);
}
