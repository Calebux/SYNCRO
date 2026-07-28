#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use super::{FxOracleContract, FxOracleContractClient};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register(FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    
    client.init(&admin);
    
    (env, contract_id, admin, signer1)
}

#[test]
fn test_init() {
    let (env, _id, admin, _signer) = setup();
    let client = FxOracleContractClient::new(&env, &_id);
    
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.is_paused(), false);
    assert_eq!(client.get_staleness_bound(), 3600);
    assert_eq!(client.get_signers().len(), 0);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_cannot_init_twice() {
    let (env, id, _admin, _signer) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    let another = Address::generate(&env);
    client.init(&another);
}

#[test]
fn test_add_signer() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    assert_eq!(client.is_signer(&signer1), true);
    assert_eq!(client.get_signers().len(), 1);
}

#[test]
#[should_panic(expected = "Signer already authorized")]
fn test_cannot_add_duplicate_signer() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    client.add_signer(&signer1); // Should panic
}

#[test]
fn test_remove_signer() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    assert_eq!(client.is_signer(&signer1), true);
    
    client.remove_signer(&signer1);
    assert_eq!(client.is_signer(&signer1), false);
    assert_eq!(client.get_signers().len(), 0);
}

#[test]
#[should_panic(expected = "Signer not found")]
fn test_cannot_remove_nonexistent_signer() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.remove_signer(&signer1); // Should panic
}

#[test]
fn test_set_staleness_bound() {
    let (env, id, _admin, _signer) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.set_staleness_bound(&7200); // 2 hours
    assert_eq!(client.get_staleness_bound(), 7200);
}

#[test]
#[should_panic(expected = "Staleness bound must be > 0")]
fn test_staleness_bound_must_be_positive() {
    let (env, id, _admin, _signer) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.set_staleness_bound(&0); // Should panic
}

#[test]
fn test_update_rate() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128; // 0.92 EUR per USD (8 decimals)
    let timestamp = env.ledger().timestamp();
    
    // Update rate as signer
    client.update_rate(&base, &quote, &rate, &timestamp, &signer1);
    
    let rate_data = client.get_rate(&base, &quote);
    assert_eq!(rate_data.rate, rate);
    assert_eq!(rate_data.base_currency, base);
    assert_eq!(rate_data.quote_currency, quote);
    assert_eq!(rate_data.signer, signer1);
}

#[test]
#[should_panic(expected = "Unauthorized signer")]
fn test_unauthorized_cannot_update_rate() {
    let (env, id, _admin, _signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    let unauthorized = Address::generate(&env);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128;
    let timestamp = env.ledger().timestamp();
    
    // Should panic - unauthorized signer
    client.update_rate(&base, &quote, &rate, &timestamp, &unauthorized);
}

#[test]
#[should_panic(expected = "Rate must be positive")]
fn test_rate_must_be_positive() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let timestamp = env.ledger().timestamp();
    
    // Should panic - negative rate
    client.update_rate(&base, &quote, &-1, &timestamp, &signer1);
}

#[test]
fn test_validate_rate_success() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128;
    let timestamp = env.ledger().timestamp();
    
    client.update_rate(&base, &quote, &rate, &timestamp, &signer1);
    
    // Validation should succeed
    let validated = client.validate_rate(&base, &quote);
    assert_eq!(validated.rate, rate);
}

#[test]
#[should_panic(expected = "Rate not found")]
fn test_validate_rate_not_found() {
    let (env, id, _admin, _signer) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "JPY");
    
    // Rate doesn't exist - should panic
    client.validate_rate(&base, &quote);
}

#[test]
#[should_panic(expected = "Rate is stale")]
fn test_validate_rate_stale() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128;
    let timestamp = env.ledger().timestamp();
    
    client.update_rate(&base, &quote, &rate, &timestamp, &signer1);
    
    // Fast-forward time beyond staleness bound (3600 seconds)
    env.ledger().with_mut(|li| {
        li.timestamp = timestamp + 3601;
    });
    
    // Validation should panic due to staleness
    client.validate_rate(&base, &quote);
}

#[test]
#[should_panic(expected = "Signer no longer authorized")]
fn test_validate_rate_signer_removed() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128;
    let timestamp = env.ledger().timestamp();
    
    client.update_rate(&base, &quote, &rate, &timestamp, &signer1);
    
    // Remove the signer
    client.remove_signer(&signer1);
    
    // Validation should panic - signer no longer authorized
    client.validate_rate(&base, &quote);
}

#[test]
fn test_convert() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128; // 0.92 EUR per USD
    let timestamp = env.ledger().timestamp();
    
    client.update_rate(&base, &quote, &rate, &timestamp, &signer1);
    
    // Convert 100 USD to EUR
    let amount_usd = 100_00000000_i128; // 100 USD with 8 decimals
    let amount_eur = client.convert(&amount_usd, &base, &quote);
    
    // Expected: 100 * 0.92 = 92 EUR
    assert_eq!(amount_eur, 92_00000000_i128);
}

#[test]
#[should_panic(expected = "Oracle is paused")]
fn test_pause_prevents_updates() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    client.set_paused(&true);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128;
    let timestamp = env.ledger().timestamp();
    
    // Should panic when paused
    client.update_rate(&base, &quote, &rate, &timestamp, &signer1);
}

#[test]
#[should_panic(expected = "Oracle is paused")]
fn test_pause_prevents_validation() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    
    let base = String::from_str(&env, "USD");
    let quote = String::from_str(&env, "EUR");
    let rate = 92_000_000_i128;
    let timestamp = env.ledger().timestamp();
    
    // Update rate first (while not paused)
    client.update_rate(&base, &quote, &rate, &timestamp, &signer1);
    
    // Now pause
    client.set_paused(&true);
    
    // Validation should panic when paused
    client.validate_rate(&base, &quote);
}

#[test]
fn test_multiple_signers() {
    let (env, id, admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    
    client.add_signer(&signer1);
    client.add_signer(&signer2);
    client.add_signer(&signer3);
    
    assert_eq!(client.get_signers().len(), 3);
    assert!(client.is_signer(&signer1));
    assert!(client.is_signer(&signer2));
    assert!(client.is_signer(&signer3));
    assert!(!client.is_signer(&admin));
}

#[test]
fn test_multiple_currency_pairs() {
    let (env, id, _admin, signer1) = setup();
    let client = FxOracleContractClient::new(&env, &id);
    
    client.add_signer(&signer1);
    env.set_auths(&[]);
    
    let timestamp = env.ledger().timestamp();
    
    // Update multiple pairs
    let usd_eur = (String::from_str(&env, "USD"), String::from_str(&env, "EUR"), 92_000_000_i128);
    let usd_gbp = (String::from_str(&env, "USD"), String::from_str(&env, "GBP"), 79_000_000_i128);
    let usd_jpy = (String::from_str(&env, "USD"), String::from_str(&env, "JPY"), 14500_000_000_i128);
    
    client.update_rate(&usd_eur.0, &usd_eur.1, &usd_eur.2, &timestamp, &signer1);
    client.update_rate(&usd_gbp.0, &usd_gbp.1, &usd_gbp.2, &timestamp, &signer1);
    client.update_rate(&usd_jpy.0, &usd_jpy.1, &usd_jpy.2, &timestamp, &signer1);
    
    // Verify all rates are stored independently
    assert_eq!(client.get_rate(&usd_eur.0, &usd_eur.1).rate, usd_eur.2);
    assert_eq!(client.get_rate(&usd_gbp.0, &usd_gbp.1).rate, usd_gbp.2);
    assert_eq!(client.get_rate(&usd_jpy.0, &usd_jpy.1).rate, usd_jpy.2);
}
