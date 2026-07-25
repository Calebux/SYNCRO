#![cfg(test)]

use super::*;
use soroban_sdk::Env;

/// Register the contract and return a client for testing.
fn register_contract(env: &Env) -> DeadMansSwitchContractClient<'static> {
    let contract_id = env.register_contract(None, DeadMansSwitchContract);
    DeadMansSwitchContractClient::new(env, &contract_id)
}

/// Standard test setup with env and admin.
fn setup() -> (Env, DeadMansSwitchContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let client = register_contract(&env);
    client.init(&admin);

    (env, client, admin)
}

// ── Registration tests ────────────────────────────────────────────

#[test]
fn test_register_switch_success() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 1u64;
    let threshold = 3600u64; // 1 hour

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.register_switch(&owner, &sub_id, &threshold);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.sub_id, sub_id);
    assert_eq!(switch.owner, owner);
    assert_eq!(switch.lapse_threshold, threshold);
    assert_eq!(switch.last_heartbeat, 1000);
    assert_eq!(switch.state, SwitchState::Active);
    assert_eq!(switch.created_at, 1000);
}

#[test]
#[should_panic(expected = "Lapse threshold must be greater than 0")]
fn test_register_switch_zero_threshold() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 2u64;

    client.register_switch(&owner, &sub_id, &0u64);
}

#[test]
#[should_panic(expected = "Switch already registered for this subscription")]
fn test_register_switch_duplicate() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 3u64;
    let threshold = 3600u64;

    client.register_switch(&owner, &sub_id, &threshold);
    client.register_switch(&owner, &sub_id, &threshold);
}

#[test]
#[should_panic(expected = "Protocol is paused")]
fn test_register_switch_when_paused() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 4u64;

    client.set_paused(&true);
    client.register_switch(&owner, &sub_id, &3600u64);
}

// ── Heartbeat tests ───────────────────────────────────────────────

#[test]
fn test_heartbeat_updates_timestamp() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 10u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &3600u64);

    // Advance time and send heartbeat
    env.ledger().with_mut(|li| {
        li.timestamp = 2000;
    });
    client.heartbeat(&owner, &sub_id);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.last_heartbeat, 2000);
    assert_eq!(switch.state, SwitchState::Active);
}

#[test]
fn test_multiple_heartbeats() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 11u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &3600u64);

    // First heartbeat
    env.ledger().with_mut(|li| {
        li.timestamp = 2000;
    });
    client.heartbeat(&owner, &sub_id);

    // Second heartbeat
    env.ledger().with_mut(|li| {
        li.timestamp = 3500;
    });
    client.heartbeat(&owner, &sub_id);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.last_heartbeat, 3500);
    assert_eq!(switch.state, SwitchState::Active);
}

#[test]
#[should_panic(expected = "Switch not found")]
fn test_heartbeat_nonexistent_switch() {
    let (env, client, _admin) = setup();

    let caller = Address::generate(&env);
    client.heartbeat(&caller, &999u64);
}

#[test]
#[should_panic(expected = "Switch is not active")]
fn test_heartbeat_cancelled_switch() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 12u64;

    client.register_switch(&owner, &sub_id, &3600u64);
    client.cancel_switch(&owner, &sub_id);

    // Try to heartbeat a cancelled switch
    client.heartbeat(&owner, &sub_id);
}

#[test]
#[should_panic(expected = "Switch is not active")]
fn test_heartbeat_lapsed_switch() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 13u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &3600u64);

    // Advance past threshold to trigger lapse
    env.ledger().with_mut(|li| {
        li.timestamp = 5000;
    });
    client.check_lapse(&sub_id);

    // Try to heartbeat a lapsed switch
    client.heartbeat(&owner, &sub_id);
}

#[test]
#[should_panic(expected = "Protocol is paused")]
fn test_heartbeat_when_paused() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 14u64;

    client.register_switch(&owner, &sub_id, &3600u64);
    client.set_paused(&true);
    client.heartbeat(&owner, &sub_id);
}

// ── Lapse detection tests ─────────────────────────────────────────

#[test]
fn test_check_lapse_detects_expired_switch() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 20u64;
    let threshold = 3600u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    // Advance time past the threshold
    env.ledger().with_mut(|li| {
        li.timestamp = 5000;
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Lapsed);

    // Verify switch is now lapsed
    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.state, SwitchState::Lapsed);
}

#[test]
fn test_check_lapse_not_lapsed_when_within_threshold() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 21u64;
    let threshold = 3600u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    // Advance but stay within threshold
    env.ledger().with_mut(|li| {
        li.timestamp = 3000; // 2000s elapsed, still < 3600
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Active);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.state, SwitchState::Active);
}

#[test]
fn test_check_lapse_at_exact_threshold_boundary() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 22u64;
    let threshold = 3600u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    // Exactly at the threshold (elapsed = threshold, not >)
    env.ledger().with_mut(|li| {
        li.timestamp = 4600; // 3600 elapsed exactly
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Active); // Must be strictly > threshold
}

#[test]
fn test_check_lapse_just_past_threshold() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 23u64;
    let threshold = 3600u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    // Just one second past threshold
    env.ledger().with_mut(|li| {
        li.timestamp = 4601; // 3601 elapsed, > threshold
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Lapsed);
}

#[test]
fn test_check_lapse_after_heartbeat_resets_timer() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 24u64;
    let threshold = 3600u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    // Advance close to threshold
    env.ledger().with_mut(|li| {
        li.timestamp = 4000;
    });
    client.heartbeat(&owner, &sub_id); // Resets last_heartbeat to 4000

    // Advance further, but still within threshold from new heartbeat
    env.ledger().with_mut(|li| {
        li.timestamp = 7000; // Only 3000 elapsed since heartbeat
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Active);
}

#[test]
fn test_check_lapse_idempotent() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 25u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &3600u64);

    // Trigger lapse
    env.ledger().with_mut(|li| {
        li.timestamp = 5000;
    });
    let state1 = client.check_lapse(&sub_id);
    assert_eq!(state1, SwitchState::Lapsed);

    // Calling again should still return Lapsed without panic
    let state2 = client.check_lapse(&sub_id);
    assert_eq!(state2, SwitchState::Lapsed);
}

#[test]
fn test_check_lapse_returns_cancelled_for_cancelled_switch() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 26u64;

    client.register_switch(&owner, &sub_id, &3600u64);
    client.cancel_switch(&owner, &sub_id);

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Cancelled);
}

#[test]
#[should_panic(expected = "Switch not found")]
fn test_check_lapse_nonexistent_switch() {
    let (env, client, _admin) = setup();
    client.check_lapse(&999u64);
}

// ── Cancel switch tests ───────────────────────────────────────────

#[test]
fn test_cancel_switch_success() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 30u64;

    client.register_switch(&owner, &sub_id, &3600u64);
    client.cancel_switch(&owner, &sub_id);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.state, SwitchState::Cancelled);
}

#[test]
#[should_panic(expected = "Switch already cancelled")]
fn test_cancel_switch_twice() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 31u64;

    client.register_switch(&owner, &sub_id, &3600u64);
    client.cancel_switch(&owner, &sub_id);
    client.cancel_switch(&owner, &sub_id);
}

#[test]
#[should_panic(expected = "Switch not found")]
fn test_cancel_nonexistent_switch() {
    let (env, client, _admin) = setup();

    let caller = Address::generate(&env);
    client.cancel_switch(&caller, &999u64);
}

// ── Authorization tests ───────────────────────────────────────────

#[test]
fn test_check_lapse_works_any_caller() {
    // check_lapse is permissionless — anyone can trigger a lapse check
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 40u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &3600u64);

    env.ledger().with_mut(|li| {
        li.timestamp = 5000;
    });

    // check_lapse doesn't require auth, anyone can call it
    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Lapsed);
}

// ── Pause/unpause tests ───────────────────────────────────────────

#[test]
fn test_pause_and_unpause() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 50u64;

    client.register_switch(&owner, &sub_id, &3600u64);

    // Pause
    client.set_paused(&true);
    assert!(client.is_paused());

    // Unpause
    client.set_paused(&false);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_cannot_init_twice() {
    let (env, client, _admin) = setup();
    let another_admin = Address::generate(&env);
    client.init(&another_admin);
}

#[test]
fn test_check_lapse_works_when_paused() {
    // check_lapse should work even when paused — it's a read-like safety check
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 51u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.register_switch(&owner, &sub_id, &3600u64);

    client.set_paused(&true);

    env.ledger().with_mut(|li| {
        li.timestamp = 5000;
    });

    // check_lapse doesn't check pause state (it's a safety mechanism)
    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Lapsed);
}

// ── Full lifecycle tests ──────────────────────────────────────────

#[test]
fn test_full_lifecycle_register_heartbeat_lapse() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 60u64;
    let threshold = 7200u64; // 2 hours

    // 1. Register
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.state, SwitchState::Active);
    assert_eq!(switch.last_heartbeat, 1_000_000);

    // 2. Heartbeat after 1 hour
    env.ledger().with_mut(|li| {
        li.timestamp = 1_003_600;
    });
    client.heartbeat(&owner, &sub_id);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.last_heartbeat, 1_003_600);

    // 3. Heartbeat again after another hour
    env.ledger().with_mut(|li| {
        li.timestamp = 1_007_200;
    });
    client.heartbeat(&owner, &sub_id);

    // 4. Miss heartbeat and let it lapse
    env.ledger().with_mut(|li| {
        li.timestamp = 1_015_000; // > 7200 since last heartbeat (1_007_200)
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Lapsed);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.state, SwitchState::Lapsed);
}

#[test]
fn test_large_threshold_with_short_window() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 61u64;
    let threshold = 86_400u64; // 24 hours

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    // Only 1 hour elapsed — well within threshold
    env.ledger().with_mut(|li| {
        li.timestamp = 1_003_600;
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Active);
}

#[test]
fn test_cancel_then_check_lapse() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 62u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });
    client.register_switch(&owner, &sub_id, &3600u64);

    // Cancel before any heartbeat
    client.cancel_switch(&owner, &sub_id);

    // Advance past threshold
    env.ledger().with_mut(|li| {
        li.timestamp = 2_000_000;
    });

    let state = client.check_lapse(&sub_id);
    assert_eq!(state, SwitchState::Cancelled);
}

#[test]
fn test_multiple_switches_independent() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id_1 = 70u64;
    let sub_id_2 = 71u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });
    client.register_switch(&owner, &sub_id_1, &3600u64);
    client.register_switch(&owner, &sub_id_2, &7200u64);

    // Heartbeat only switch 1
    env.ledger().with_mut(|li| {
        li.timestamp = 1_004_000;
    });
    client.heartbeat(&owner, &sub_id_1);

    // Advance past switch 1's original threshold but not its new heartbeat
    // Switch 2 should lapse (5000 > 7200? No, 5000 - 1000000 = 4000 < 7200)
    env.ledger().with_mut(|li| {
        li.timestamp = 1_009_000; // 9000 elapsed since original, 5000 since heartbeat 1, 9000 for switch 2
    });

    // Switch 1: last_heartbeat=1_004_000, elapsed=5_000, threshold=3600 -> LAPSED
    let state1 = client.check_lapse(&sub_id_1);
    assert_eq!(state1, SwitchState::Lapsed);

    // Switch 2: last_heartbeat=1_000_000, elapsed=9_000, threshold=7200 -> LAPSED
    let state2 = client.check_lapse(&sub_id_2);
    assert_eq!(state2, SwitchState::Lapsed);
}

#[test]
#[should_panic(expected = "Switch not found")]
fn test_get_switch_nonexistent() {
    let (env, client, _admin) = setup();
    client.get_switch(&999u64);
}

#[test]
fn test_get_switch_returns_full_data() {
    let (env, client, _admin) = setup();

    let owner = Address::generate(&env);
    let sub_id = 80u64;
    let threshold = 5400u64;

    env.ledger().with_mut(|li| {
        li.timestamp = 1_700_000_000;
    });
    client.register_switch(&owner, &sub_id, &threshold);

    let switch = client.get_switch(&sub_id);
    assert_eq!(switch.sub_id, sub_id);
    assert_eq!(switch.owner, owner);
    assert_eq!(switch.lapse_threshold, threshold);
    assert_eq!(switch.last_heartbeat, 1_700_000_000);
    assert_eq!(switch.state, SwitchState::Active);
    assert_eq!(switch.created_at, 1_700_000_000);
}
