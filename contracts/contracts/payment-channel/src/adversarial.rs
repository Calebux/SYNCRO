#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::{Address as _, EnvTestConfig, Ledger},
    token::{StellarAssetClient, TokenClient}, Address, Env,
};

#[contracttype]
#[derive(Clone)]
enum AttackKey {
    Victim,
    ChannelId,
    Seq,
    Reentered,
    ReenterRejected,
    Bal(Address),
}

/// Token whose `transfer` re-enters `finalize` when the channel is the sender.
#[contract]
pub struct ReentrantToken;

#[contractimpl]
impl ReentrantToken {
    pub fn set_attack(env: Env, victim: Address, channel_id: u64, seq: u64) {
        env.storage().instance().set(&AttackKey::Victim, &victim);
        env.storage().instance().set(&AttackKey::ChannelId, &channel_id);
        env.storage().instance().set(&AttackKey::Seq, &seq);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let bal: i128 = env.storage().instance().get(&AttackKey::Bal(to.clone())).unwrap_or(0);
        env.storage().instance().set(&AttackKey::Bal(to), &(bal + amount));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_bal: i128 = env.storage().instance().get(&AttackKey::Bal(from.clone())).unwrap_or(0);
        let to_bal: i128 = env.storage().instance().get(&AttackKey::Bal(to.clone())).unwrap_or(0);
        env.storage().instance().set(&AttackKey::Bal(from.clone()), &(from_bal - amount));
        env.storage().instance().set(&AttackKey::Bal(to), &(to_bal + amount));

        if let Some(victim) = env.storage().instance().get::<AttackKey, Address>(&AttackKey::Victim) {
            if from == victim {
                let already: bool = env.storage().instance().get(&AttackKey::Reentered).unwrap_or(false);
                if !already {
                    env.storage().instance().set(&AttackKey::Reentered, &true);
                    let cid: u64 = env.storage().instance().get(&AttackKey::ChannelId).unwrap();
                    let seq: u64 = env.storage().instance().get(&AttackKey::Seq).unwrap();
                    let rejected = PaymentChannelContractClient::new(&env, &victim)
                        .try_finalize(&cid, &seq)
                        .is_err();
                    env.storage().instance().set(&AttackKey::ReenterRejected, &rejected);
                }
            }
        }
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().instance().get(&AttackKey::Bal(id)).unwrap_or(0)
    }

    pub fn reenter_rejected(env: Env) -> bool {
        env.storage().instance().get(&AttackKey::ReenterRejected).unwrap_or(false)
    }
}

#[test]
fn malicious_token_reentrancy_on_finalize_is_rejected() {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    });
    env.mock_all_auths();

    let channel_id_addr = env.register_contract(None, PaymentChannelContract);
    let channel = PaymentChannelContractClient::new(&env, &channel_id_addr);
    channel.init(&Address::generate(&env));

    let token_id = env.register_contract(None, ReentrantToken);
    let evil = ReentrantTokenClient::new(&env, &token_id);

    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);
    evil.mint(&depositor, &1_000);

    let cid = channel.open_channel(&depositor, &counterparty, &token_id, &200, &10);
    channel.initiate_close(&cid, &120, &80, &1, &depositor);

    env.ledger().set_timestamp(env.ledger().timestamp() + 20);
    evil.set_attack(&channel_id_addr, &cid, &1);

    channel.finalize(&cid, &1);

    assert!(evil.reenter_rejected());
    assert_eq!(channel.get_channel(&cid).unwrap().state, ChannelState::Closed);
}

#[test]
fn double_spend_finalize_rejected() {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    });
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(&env, &sac.address()).mint(&depositor, &1_000);
    let id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &id);
    client.init(&admin);

    let cid = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &5);
    client.initiate_close(&cid, &100, &0, &1, &depositor);
    env.ledger().set_timestamp(env.ledger().timestamp() + 10);
    client.finalize(&cid, &1);
    let again = client.try_finalize(&cid, &1);
    assert_eq!(again, Err(Ok(Error::InvalidState)));
}

#[test]
fn over_withdrawal_via_negative_watchtower_state_rejected() {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    });
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(&env, &sac.address()).mint(&depositor, &1_000);
    let id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &id);
    client.init(&admin);

    let watchtower = Address::generate(&env);
    let cid = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &100);
    client.register_watchtower(&cid, &depositor, &watchtower, &0);
    client.initiate_close(&cid, &90, &10, &1, &depositor);
    let result = client.try_watchtower_submit(
        &cid, &watchtower, &-1, &101, &2, &depositor, &counterparty,
    );
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    let _ = TokenClient::new(&env, &sac.address());
}
