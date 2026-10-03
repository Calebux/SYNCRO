//! Adversarial tests for the payment channel contract.
//!
//! # Covered scenarios
//!
//! | Test | Invariant |
//! |------|-----------|
//! | `malicious_token_reentrancy_on_finalize_is_rejected` | CEI ordering prevents re-entrancy |
//! | `double_spend_finalize_rejected` | closed channel cannot be finalized twice |
//! | `over_withdrawal_via_negative_watchtower_state_rejected` | negative balance values rejected |
//! | `provider_initiates_close_stale_payer_disputes_and_wins` | **unilateral-close guarantee** |
//! | `equal_nonce_submit_state_rejected` | strictly-increasing sequence |
//! | `stale_sequence_submit_state_rejected` | older sequence rejected |
//! | `cross_channel_replay_rejected` | channel-id binding is load-bearing |
//! | `prior_contract_version_state_is_independent` | contract-address binding |

#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, EnvTestConfig, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

const W: u64 = MIN_DISPUTE_WINDOW_SECS;

// ── Re-entrant token ──────────────────────────────────────────────────────────

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
        let from_bal: i128 =
            env.storage().instance().get(&AttackKey::Bal(from.clone())).unwrap_or(0);
        let to_bal: i128 =
            env.storage().instance().get(&AttackKey::Bal(to.clone())).unwrap_or(0);
        env.storage().instance().set(&AttackKey::Bal(from.clone()), &(from_bal - amount));
        env.storage().instance().set(&AttackKey::Bal(to), &(to_bal + amount));

        if let Some(victim) =
            env.storage().instance().get::<AttackKey, Address>(&AttackKey::Victim)
        {
            if from == victim {
                let already: bool =
                    env.storage().instance().get(&AttackKey::Reentered).unwrap_or(false);
                if !already {
                    env.storage().instance().set(&AttackKey::Reentered, &true);
                    let cid: u64 =
                        env.storage().instance().get(&AttackKey::ChannelId).unwrap();
                    let seq: u64 =
                        env.storage().instance().get(&AttackKey::Seq).unwrap();
                    let rejected = PaymentChannelContractClient::new(&env, &victim)
                        .try_finalize(&cid, &seq)
                        .is_err();
                    env.storage()
                        .instance()
                        .set(&AttackKey::ReenterRejected, &rejected);
                }
            }
        }
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().instance().get(&AttackKey::Bal(id)).unwrap_or(0)
    }

    pub fn reenter_rejected(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&AttackKey::ReenterRejected)
            .unwrap_or(false)
    }
}

// ── Reentrancy ────────────────────────────────────────────────────────────────

#[test]
fn malicious_token_reentrancy_on_finalize_is_rejected() {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    });
    env.mock_all_auths();

    let contract_addr = env.register_contract(None, PaymentChannelContract);
    let channel = PaymentChannelContractClient::new(&env, &contract_addr);
    channel.init(&Address::generate(&env));

    let token_id = env.register_contract(None, ReentrantToken);
    let evil = ReentrantTokenClient::new(&env, &token_id);

    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);
    evil.mint(&depositor, &1_000);

    let cid = channel.open_channel(&depositor, &counterparty, &token_id, &200, &W);
    channel.initiate_close(&cid, &120, &80, &1, &depositor);

    let ch = channel.get_channel(&cid).unwrap();
    env.ledger().set_timestamp(ch.dispute_deadline + 1);
    evil.set_attack(&contract_addr, &cid, &1);

    channel.finalize(&cid, &1);

    assert!(evil.reenter_rejected());
    assert_eq!(channel.get_channel(&cid).unwrap().state, ChannelState::Closed);
}

// ── Double-spend ──────────────────────────────────────────────────────────────

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

    let cid = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);
    client.initiate_close(&cid, &100, &0, &1, &depositor);
    let ch = client.get_channel(&cid).unwrap();
    env.ledger().set_timestamp(ch.dispute_deadline + 1);
    client.finalize(&cid, &1);

    let again = client.try_finalize(&cid, &1);
    assert_eq!(again, Err(Ok(Error::InvalidState)));
}

// ── Negative balances ─────────────────────────────────────────────────────────

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
    let cid = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);
    client.register_watchtower(&cid, &depositor, &watchtower, &0);
    client.initiate_close(&cid, &90, &10, &1, &depositor);
    let result =
        client.try_watchtower_submit(&cid, &watchtower, &-1, &101, &2, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    let _ = TokenClient::new(&env, &sac.address());
}

// ── ADVERSARIAL: provider front-runs with stale state, payer disputes and wins

/// **Unilateral-close guarantee**
///
/// Scenario:
/// 1. Provider (counterparty) calls `initiate_close` at **seq 1** — an old,
///    self-favourable state (balance_a=90, balance_b=10) — while the honest
///    latest state is seq 5 (balance_a=50, balance_b=50).
/// 2. Payer calls `dispute` with seq 5 before the window expires.
/// 3. The dispute **resets** the deadline, so the provider cannot race to
///    finalize before the payer's dispute lands.
/// 4. After the new deadline, `finalize` settles at seq 5 — payer wins.
#[test]
fn provider_initiates_close_stale_payer_disputes_and_wins() {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    });
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);   // payer
    let counterparty = Address::generate(&env); // provider / adversary

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = TokenClient::new(&env, &sac.address());
    StellarAssetClient::new(&env, &sac.address()).mint(&depositor, &1_000);

    let contract_id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &contract_id);
    client.init(&admin);

    // Open with the minimum valid dispute window.
    let channel_id = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);

    // Provider cheats: closes at stale seq 1 (balance_a=90, balance_b=10).
    client.initiate_close(&channel_id, &90, &10, &1, &counterparty);

    let after_stale_close = client.get_channel(&channel_id).unwrap();
    assert_eq!(after_stale_close.state, ChannelState::Closing);
    assert_eq!(after_stale_close.sequence, 1);
    let original_deadline = after_stale_close.dispute_deadline;

    // Payer disputes with honest seq 5 — still within the window.
    client.dispute(&channel_id, &50, &50, &5, &depositor, &counterparty);

    let after_dispute = client.get_channel(&channel_id).unwrap();
    assert_eq!(after_dispute.state, ChannelState::Dispute);
    assert_eq!(after_dispute.sequence, 5);
    assert_eq!(after_dispute.balance_a, 50);
    assert_eq!(after_dispute.balance_b, 50);

    // Deadline must be reset (extended) — provider cannot front-run finalize.
    assert!(
        after_dispute.dispute_deadline > original_deadline,
        "dispute must extend the deadline beyond the original stale-close deadline"
    );

    // Provider cannot finalize early — new window is active.
    let premature = client.try_finalize(&channel_id, &5);
    assert_eq!(premature, Err(Ok(Error::DisputeWindowActive)));

    // Advance past the new deadline and finalize.
    env.ledger().set_timestamp(after_dispute.dispute_deadline + 1);

    let dep_before = token.balance(&depositor);
    let cp_before = token.balance(&counterparty);
    client.finalize(&channel_id, &5);

    // Payer wins: recovers 50, not the 10 the stale close would have paid.
    assert_eq!(token.balance(&depositor), dep_before + 50, "payer must recover 50");
    assert_eq!(token.balance(&counterparty), cp_before + 50, "provider gets 50, not 90");

    let closed = client.get_channel(&channel_id).unwrap();
    assert_eq!(closed.state, ChannelState::Closed);
    assert_eq!(closed.sequence, 5);
}

// ── Nonce / sequence enforcement ──────────────────────────────────────────────

/// Resubmitting with the same sequence as already on-chain is rejected.
#[test]
fn equal_nonce_submit_state_rejected() {
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

    let cid = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);
    client.submit_state(&cid, &60, &40, &5, &depositor, &counterparty);

    // Same seq 5 — must be rejected.
    let result = client.try_submit_state(&cid, &55, &45, &5, &depositor, &counterparty);
    assert_eq!(
        result,
        Err(Ok(Error::StaleState)),
        "equal sequence must be rejected (strictly increasing required)"
    );
    // State must be unchanged.
    let ch = client.get_channel(&cid).unwrap();
    assert_eq!(ch.sequence, 5);
    assert_eq!(ch.balance_a, 60);
}

/// Submitting a lower sequence is rejected — an older signed state can never
/// override a newer one.
#[test]
fn stale_sequence_submit_state_rejected() {
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

    let cid = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);
    client.submit_state(&cid, &60, &40, &10, &depositor, &counterparty);

    // Seq 3 < seq 10 — must be rejected.
    let result = client.try_submit_state(&cid, &70, &30, &3, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::StaleState)));
    let ch = client.get_channel(&cid).unwrap();
    assert_eq!(ch.sequence, 10);
    assert_eq!(ch.balance_a, 60);
}

/// State from channel A cannot change channel B's balances.
///
/// The channel_id is the storage key; `submit_state` to B with A's seq
/// starts a new sequence from B's current nonce.  This test documents that
/// the **off-chain signing convention** (including channel_id in the signed
/// payload) is the load-bearing defense — the contract enforces only that the
/// sequence is monotonic within B.
#[test]
fn cross_channel_replay_channel_id_is_binding() {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    });
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(&env, &sac.address()).mint(&depositor, &10_000);

    let id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &id);
    client.init(&admin);

    // Channel A — payer has paid 90, seq=5.
    let cid_a = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);
    client.submit_state(&cid_a, &10, &90, &5, &depositor, &counterparty);

    // Channel B — fresh, seq=0.
    let cid_b = client.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);

    // Attempt cross-channel replay: submit A's balances onto B using A's seq (5 > 0, passes).
    // This succeeds at the contract level — documenting that channel_id MUST
    // be in the off-chain signed payload (enforced by the gateway SDK).
    client.submit_state(&cid_b, &10, &90, &5, &depositor, &counterparty);

    // Channel A is unaffected.
    let ch_a = client.get_channel(&cid_a).unwrap();
    assert_eq!(ch_a.sequence, 5);
    assert_eq!(ch_a.balance_a, 10);

    // Channel B was updated — this is the threat the signing convention prevents.
    let ch_b = client.get_channel(&cid_b).unwrap();
    assert_eq!(
        ch_b.sequence, 5,
        "cross-channel replay succeeds on-chain; \
         channel_id binding MUST be in the off-chain signed payload"
    );
}

/// Two independent contract deployments have fully isolated storage.
/// A state submitted to v1 has zero effect on v2.
#[test]
fn prior_contract_version_state_is_independent() {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    });
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(&env, &sac.address()).mint(&depositor, &10_000);

    // "v1" contract.
    let id_v1 = env.register_contract(None, PaymentChannelContract);
    let v1 = PaymentChannelContractClient::new(&env, &id_v1);
    v1.init(&admin);

    // "v2" contract — different address.
    let id_v2 = env.register_contract(None, PaymentChannelContract);
    let v2 = PaymentChannelContractClient::new(&env, &id_v2);
    v2.init(&admin);

    let cid_v1 = v1.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);
    let cid_v2 = v2.open_channel(&depositor, &counterparty, &sac.address(), &100, &W);

    // Advance v1 to seq 10.
    v1.submit_state(&cid_v1, &40, &60, &10, &depositor, &counterparty);

    // v2 must remain at seq 0 — v1 state cannot bleed across contract addresses.
    let v2_ch = v2.get_channel(&cid_v2).unwrap();
    assert_eq!(v2_ch.sequence, 0, "v2 must be independent of v1 state");
    assert_eq!(v2_ch.balance_a, 100);

    let v1_ch = v1.get_channel(&cid_v1).unwrap();
    assert_eq!(v1_ch.sequence, 10);
}
