#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

const DAY: u64 = 86_400;
const MONTH: u64 = 30 * DAY;

struct Ctx {
    env: Env,
    owner: Address,
    merchant: Address,
    token: Address,
    token_client: TokenClient<'static>,
    allowance: AllowanceContractClient<'static>,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Deploy a Stellar asset token and fund the owner.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_client = TokenClient::new(&env, &token);
    StellarAssetClient::new(&env, &token).mint(&owner, &1_000_000_000i128);

    let contract_id = env.register(AllowanceContract, ());
    let allowance = AllowanceContractClient::new(&env, &contract_id);
    allowance.init(&admin);

    // Owner authorizes the contract to pull funds on its behalf.
    token_client.approve(&owner, &contract_id, &1_000_000_000i128, &1_000_000u32);

    Ctx {
        env,
        owner,
        merchant,
        token,
        token_client,
        allowance,
    }
}

fn grant(ctx: &Ctx, period_cap: i128, absolute_cap: i128, period_length: u64) -> u64 {
    ctx.allowance.grant_allowance(
        &ctx.owner,
        &ctx.merchant,
        &ctx.token,
        &period_cap,
        &absolute_cap,
        &period_length,
    )
}

#[test]
fn test_grant_creates_active_allowance() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    assert_eq!(id, 1);
    assert_eq!(ctx.allowance.get_allowance_count(), 1);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.owner, ctx.owner);
    assert_eq!(a.merchant, ctx.merchant);
    assert_eq!(a.period_cap, 50);
    assert_eq!(a.absolute_cap, 600);
    assert_eq!(a.period_length, MONTH);
    assert_eq!(a.period_spent, 0);
    assert_eq!(a.total_spent, 0);
    assert!(a.active);
}

#[test]
fn test_consume_transfers_and_tracks_spend() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &30);

    // Funds moved owner -> merchant.
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 30);
    assert_eq!(ctx.token_client.balance(&ctx.owner), 1_000_000_000 - 30);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_spent, 30);
    assert_eq!(a.total_spent, 30);
    assert_eq!(ctx.allowance.available(&id), 20); // period budget is binding
}

#[test]
fn test_multiple_pulls_within_period_accumulate() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &20);
    ctx.allowance.consume(&id, &25);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_spent, 45);
    assert_eq!(a.total_spent, 45);
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 45);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_period_cap_enforced() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &40);
    // 40 + 20 = 60 > per-period cap of 50 -> PeriodCapExceeded
    ctx.allowance.consume(&id, &20);
}

#[test]
fn test_period_resets_after_period_length() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &50); // period exhausted

    // Advance one full period.
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);

    // Fresh period budget available again.
    ctx.allowance.consume(&id, &50);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_spent, 50);
    assert_eq!(a.total_spent, 100);
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 100);
}

#[test]
fn test_period_reset_aligns_to_boundaries() {
    let ctx = setup();
    let start = ctx.env.ledger().timestamp();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &10);
    // Jump ~2.5 periods forward.
    ctx.env.ledger().set_timestamp(start + 2 * MONTH + DAY);
    ctx.allowance.consume(&id, &10);

    let a = ctx.allowance.get_allowance(&id);
    // period_start should have advanced by exactly 2 whole periods.
    assert_eq!(a.period_start, start + 2 * MONTH);
    assert_eq!(a.period_spent, 10);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_absolute_cap_enforced_across_periods() {
    let ctx = setup();
    // period cap 50, absolute cap 120, so third full period pull breaches total.
    let id = grant(&ctx, 50, 120, MONTH);

    ctx.allowance.consume(&id, &50);
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);
    ctx.allowance.consume(&id, &50); // total 100

    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);
    // 100 + 50 = 150 > absolute cap 120 -> AbsoluteCapExceeded
    ctx.allowance.consume(&id, &50);
}

#[test]
fn test_available_tracks_absolute_cap_when_binding() {
    let ctx = setup();
    // Absolute budget (60) is tighter than a fresh period budget (50) only
    // after enough has been spent; verify `available` reflects the minimum.
    let id = grant(&ctx, 50, 60, MONTH);
    ctx.allowance.consume(&id, &50); // total 50, period 50
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);
    // New period: period budget 50, but only 10 left against absolute cap.
    assert_eq!(ctx.allowance.available(&id), 10);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_consume_after_revoke_fails() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.revoke_allowance(&id);
    let a = ctx.allowance.get_allowance(&id);
    assert!(!a.active);
    assert_eq!(ctx.allowance.available(&id), 0);

    ctx.allowance.consume(&id, &10);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_double_revoke_fails() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.revoke_allowance(&id);
    ctx.allowance.revoke_allowance(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_cannot_grant_to_self() {
    let ctx = setup();
    ctx.allowance
        .grant_allowance(&ctx.owner, &ctx.owner, &ctx.token, &50, &600, &MONTH);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_period_cap_above_absolute_rejected() {
    let ctx = setup();
    grant(&ctx, 600, 50, MONTH);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_zero_cap_rejected() {
    let ctx = setup();
    grant(&ctx, 0, 600, MONTH);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_zero_period_rejected() {
    let ctx = setup();
    grant(&ctx, 50, 600, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_zero_amount_consume_rejected() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.consume(&id, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_consume_unknown_allowance_fails() {
    let ctx = setup();
    ctx.allowance.consume(&999, &10);
}

#[test]
fn test_update_caps() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.consume(&id, &40);

    ctx.allowance.update_caps(&id, &100, &1000);
    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_cap, 100);
    assert_eq!(a.absolute_cap, 1000);

    // The raised period cap now permits a larger pull in the same period.
    ctx.allowance.consume(&id, &60);
    assert_eq!(ctx.allowance.get_allowance(&id).period_spent, 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_update_caps_below_spent_rejected() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.consume(&id, &40);
    // New period cap 30 < already-spent 40 -> CapBelowSpent.
    ctx.allowance.update_caps(&id, &30, &600);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_consume_blocked_when_paused() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.pause();
    ctx.allowance.consume(&id, &10);
}

#[test]
fn test_consume_resumes_after_unpause() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.pause();
    assert!(ctx.allowance.is_paused());
    ctx.allowance.unpause();
    ctx.allowance.consume(&id, &10);
    assert_eq!(ctx.allowance.get_allowance(&id).total_spent, 10);
}

#[test]
fn test_independent_allowances_are_isolated() {
    let ctx = setup();
    let merchant2 = Address::generate(&ctx.env);
    let id1 = grant(&ctx, 50, 600, MONTH);
    let id2 = ctx
        .allowance
        .grant_allowance(&ctx.owner, &merchant2, &ctx.token, &10, &100, &DAY);

    ctx.allowance.consume(&id1, &50);
    ctx.allowance.consume(&id2, &10);

    assert_eq!(ctx.allowance.get_allowance(&id1).total_spent, 50);
    assert_eq!(ctx.allowance.get_allowance(&id2).total_spent, 10);
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 50);
    assert_eq!(ctx.token_client.balance(&merchant2), 10);
}

// ── Indexer events (issue #1430) ────────────────────────────────────────────

mod indexer_events {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::Events as _,
        xdr::{ContractEventBody, ScVal},
    };
    use std::string::ToString;
    use std::vec::Vec;

    /// Topics of every recorded event as plain strings.
    fn event_topics(ctx: &Ctx) -> Vec<Vec<std::string::String>> {
        ctx.env
            .events()
            .all()
            .events()
            .iter()
            .map(|event| match &event.body {
                ContractEventBody::V0(v0) => v0
                    .topics
                    .iter()
                    .map(|topic| match topic {
                        ScVal::Symbol(s) => std::string::String::from_utf8_lossy(&s.0).into_owned(),
                        other => std::format!("{:?}", other),
                    })
                    .collect(),
            })
            .collect()
    }

    /// Payload of the first recorded event as (key, value-debug) pairs.
    fn first_event_data(ctx: &Ctx) -> Vec<(std::string::String, std::string::String)> {
        let events = ctx.env.events().all();
        let first = events.events().first().expect("expected an event");
        event_data(first)
    }

    /// Payload of the last recorded event as (key, value-debug) pairs.
    fn last_event_data(ctx: &Ctx) -> Vec<(std::string::String, std::string::String)> {
        let events = ctx.env.events().all();
        let last = events.events().last().expect("expected an event");
        event_data(last)
    }

    fn event_data(
        event: &soroban_sdk::xdr::ContractEvent,
    ) -> Vec<(std::string::String, std::string::String)> {
        match &event.body {
            ContractEventBody::V0(v0) => match &v0.data {
                ScVal::Map(Some(entries)) => entries
                    .iter()
                    .map(|entry| {
                        let key = match &entry.key {
                            ScVal::Symbol(s) => {
                                std::string::String::from_utf8_lossy(&s.0).into_owned()
                            }
                            other => std::format!("{:?}", other),
                        };
                        (key, std::format!("{:?}", entry.val))
                    })
                    .collect(),
                other => panic!("expected map payload, got {:?}", other),
            },
        }
    }

    fn data_value(
        data: &[(std::string::String, std::string::String)],
        key: &str,
    ) -> std::string::String {
        data.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| panic!("missing payload key {}", key))
    }

    fn count_topic(ctx: &Ctx, needle: &str) -> usize {
        event_topics(ctx)
            .iter()
            .filter(|topics| topics.iter().any(|t| t.contains(needle)))
            .count()
    }

    // NOTE: `env.events().all()` returns only the LAST invocation's events,
    // so each assertion below reads the events of the call under test.

    #[test]
    fn pause_and_unpause_emit_suspend_events() {
        let ctx = setup();

        ctx.allowance.pause();
        let topics = event_topics(&ctx);
        assert_eq!(topics.len(), 1);
        // contractevent topics lead with the snake_case event name.
        assert!(topics[0].iter().any(|t| t.contains("paused")));
        let data = last_event_data(&ctx);
        assert!(data_value(&data, "paused").contains("true"));
        assert!(data_value(&data, "schema_version").contains("U32(1)"));

        ctx.allowance.unpause();
        let topics = event_topics(&ctx);
        assert_eq!(topics.len(), 1);
        assert!(topics[0].iter().any(|t| t.contains("paused")));
        let data = last_event_data(&ctx);
        assert!(data_value(&data, "paused").contains("false"));
    }

    #[test]
    fn consume_across_period_boundary_emits_rollover() {
        let ctx = setup();
        let id = grant(&ctx, 50, 600, MONTH);
        ctx.allowance.consume(&id, &50);
        assert_eq!(count_topic(&ctx, "rolled_over"), 0);

        ctx.env
            .ledger()
            .set_timestamp(ctx.env.ledger().timestamp() + MONTH + DAY);
        ctx.allowance.consume(&id, &10);

        // Rollover publishes before the consume event in the same call.
        // (The token contract's own transfer event is also recorded.)
        let topics = event_topics(&ctx);
        assert!(topics[0].iter().any(|t| t.contains("rolled_over")));
        assert!(topics
            .iter()
            .any(|t| t.iter().any(|s| s.contains("consumed"))));
    }

    #[test]
    fn rollover_event_carries_new_window_and_version() {
        let ctx = setup();
        let start = ctx.env.ledger().timestamp();
        let id = grant(&ctx, 50, 600, MONTH);
        ctx.allowance.consume(&id, &10);

        ctx.env.ledger().set_timestamp(start + 2 * MONTH);
        ctx.allowance.consume(&id, &10);

        let topics = event_topics(&ctx);
        assert!(topics[0].iter().any(|t| t.contains("rolled_over")));

        let data = first_event_data(&ctx);
        assert!(data_value(&data, "new_period_start").contains(&(start + 2 * MONTH).to_string()));
        assert!(data_value(&data, "schema_version").contains("U32(1)"));
    }
}
