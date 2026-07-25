use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String};
use subscription_registry::{SubscriptionRegistry, SubscriptionRegistryClient};

#[test]
fn test_create_subscription() {
    // Test basic subscription creation
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let service_id = String::from_str(&env, "netflix");
    let billing_interval = 2592000u64;
    let expected_amount = 1599i128;
    let next_renewal = 1735689600u64;
    let encrypted_blob = Bytes::from_slice(&env, &[1u8, 2, 3, 4, 5]);

    let subscription_id = client.create_subscription(
        &user,
        &service_id,
        &billing_interval,
        &expected_amount,
        &next_renewal,
        &encrypted_blob,
    );

    // Verify subscription metadata was stored correctly
    let metadata = client.get_subscription(&subscription_id).unwrap();
    assert_eq!(metadata.service_id, service_id);
    assert_eq!(metadata.billing_interval, billing_interval);
    assert_eq!(metadata.expected_amount, expected_amount);
    assert_eq!(metadata.next_renewal, next_renewal);
    assert!(metadata.is_active);
    assert_eq!(metadata.encrypted_blob, encrypted_blob);

    // Verify subscription is mapped to user
    let user_subs = client.get_user_subscriptions(&user);
    assert_eq!(user_subs.len(), 1);
    assert_eq!(user_subs.get(0).unwrap(), subscription_id);
}

#[test]
fn test_create_multiple_subscriptions() {
    // Test that a user can have multiple subscriptions
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);

    let sub1_id = client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[1u8, 2, 3]),
    );

    let sub2_id = client.create_subscription(
        &user,
        &String::from_str(&env, "spotify"),
        &2592000u64,
        &999i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[4u8, 5, 6]),
    );

    let sub3_id = client.create_subscription(
        &user,
        &String::from_str(&env, "hulu"),
        &2592000u64,
        &799i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[7u8, 8, 9]),
    );

    // Verify all subscriptions are associated with the user
    let user_subs = client.get_user_subscriptions(&user);
    assert_eq!(user_subs.len(), 3);
    assert!(user_subs.contains(&sub1_id));
    assert!(user_subs.contains(&sub2_id));
    assert!(user_subs.contains(&sub3_id));
}

#[test]
fn test_update_subscription() {
    // Test updating subscription metadata
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let encrypted_blob = Bytes::from_slice(&env, &[1u8, 2, 3, 4, 5]);
    let subscription_id = client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &encrypted_blob,
    );

    // Update amount and renewal date
    let new_amount = 1799i128;
    let new_renewal = 1738281600u64;
    let new_encrypted_blob = Bytes::from_slice(&env, &[10u8, 11, 12]);
    client.update_subscription(
        &subscription_id,
        &user,
        &None,
        &None,
        &Some(new_amount),
        &Some(new_renewal),
        &Some(new_encrypted_blob),
    );

    // Verify updates were applied
    let metadata = client.get_subscription(&subscription_id).unwrap();
    assert_eq!(metadata.expected_amount, new_amount);
    assert_eq!(metadata.next_renewal, new_renewal);
    assert_eq!(metadata.encrypted_blob, new_encrypted_blob);
}

#[test]
fn test_cancel_subscription() {
    // Test canceling a subscription
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let encrypted_blob = Bytes::from_slice(&env, &[1u8, 2, 3]);
    let subscription_id = client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &encrypted_blob,
    );

    client.cancel_subscription(&subscription_id, &user);

    // Verify subscription is marked as inactive
    let metadata = client.get_subscription(&subscription_id).unwrap();
    assert!(!metadata.is_active);
}

#[test]
#[should_panic(expected = "billing_interval must be greater than 0")]
fn test_create_subscription_invalid_billing_interval() {
    // Test validation: billing interval cannot be zero
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &0u64,
        &1599i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[1u8, 2, 3]),
    );
}

#[test]
#[should_panic(expected = "expected_amount must be non-negative")]
fn test_create_subscription_negative_amount() {
    // Test validation: expected amount must be positive
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &-100i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[1u8, 2, 3]),
    );
}

#[test]
#[should_panic(expected = "subscription not found")]
fn test_update_nonexistent_subscription() {
    // Test error handling: cannot update non-existent subscription
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let fake_id = BytesN::from_array(&env, &[0u8; 32]);

    client.update_subscription(&fake_id, &user, &None, &None, &Some(1999i128), &None, &None);
}

#[test]
#[should_panic(expected = "subscription is already cancelled")]
fn test_cancel_already_cancelled_subscription() {
    // Test error handling: cannot cancel an already cancelled subscription
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let encrypted_blob = Bytes::from_slice(&env, &[1u8, 2, 3]);
    let subscription_id = client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &encrypted_blob,
    );

    client.cancel_subscription(&subscription_id, &user);
    client.cancel_subscription(&subscription_id, &user);
}

#[test]
#[should_panic(expected = "subscription is not active")]
fn test_update_cancelled_subscription() {
    // Test error handling: cannot update a cancelled subscription
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let encrypted_blob = Bytes::from_slice(&env, &[1u8, 2, 3]);
    let subscription_id = client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &encrypted_blob,
    );

    client.cancel_subscription(&subscription_id, &user);
    client.update_subscription(
        &subscription_id,
        &user,
        &None,
        &None,
        &Some(1999i128),
        &None,
        &None,
    );
}

#[test]
fn test_get_nonexistent_subscription() {
    // Test querying non-existent subscription returns None
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let fake_id = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.get_subscription(&fake_id);
    assert!(result.is_none());
}

#[test]
fn test_multiple_users_independent() {
    // Test that different users have independent subscription lists
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let sub1_id = client.create_subscription(
        &user1,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[1u8, 2, 3]),
    );

    let sub2_id = client.create_subscription(
        &user2,
        &String::from_str(&env, "spotify"),
        &2592000u64,
        &999i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[4u8, 5, 6]),
    );

    // Verify users have separate subscription lists
    let user1_subs = client.get_user_subscriptions(&user1);
    assert_eq!(user1_subs.len(), 1);
    assert_eq!(user1_subs.get(0).unwrap(), sub1_id);

    let user2_subs = client.get_user_subscriptions(&user2);
    assert_eq!(user2_subs.len(), 1);
    assert_eq!(user2_subs.get(0).unwrap(), sub2_id);
}

#[test]
fn test_subscription_id_uniqueness() {
    // Test that each subscription gets a unique ID
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);

    let sub1_id = client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[1u8, 2, 3]),
    );
    let sub2_id = client.create_subscription(
        &user,
        &String::from_str(&env, "spotify"),
        &2592000u64,
        &999i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[4u8, 5, 6]),
    );
    let sub3_id = client.create_subscription(
        &user,
        &String::from_str(&env, "hulu"),
        &2592000u64,
        &799i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[7u8, 8, 9]),
    );

    // Verify all subscription IDs are unique
    assert_ne!(sub1_id, sub2_id);
    assert_ne!(sub2_id, sub3_id);
    assert_ne!(sub1_id, sub3_id);
}

#[test]
#[should_panic(expected = "duplicate subscription for service")]
fn test_create_duplicate_subscription_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let service_id = String::from_str(&env, "netflix");

    client.create_subscription(
        &user,
        &service_id,
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[1u8, 2, 3]),
    );

    // This second one should panic
    client.create_subscription(
        &user,
        &service_id,
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &Bytes::from_slice(&env, &[4u8, 5, 6]),
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_update_subscription_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SubscriptionRegistry, ());
    let client = SubscriptionRegistryClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let encrypted_blob = Bytes::from_slice(&env, &[1u8, 2, 3]);
    let subscription_id = client.create_subscription(
        &user,
        &String::from_str(&env, "netflix"),
        &2592000u64,
        &1599i128,
        &1735689600u64,
        &encrypted_blob,
    );

    // Clear mock auths to simulate unauthorized user
    env.set_auths(&[]);

    // This should panic due to require_auth
    client.update_subscription(
        &subscription_id,
        &user,
        &None,
        &None,
        &Some(1999i128),
        &None,
        &None,
    );
}
