use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, vec, xdr::ToXdr, Address, Bytes,
    BytesN, Env, String, Vec,
};

/// Minimum billing interval: 1 day (seconds).
const MIN_INTERVAL: u64 = 86_400;
/// Maximum billing interval: 365 days (seconds).
const MAX_INTERVAL: u64 = 31_536_000;
/// Maximum payment amount accepted at registration.
const MAX_AMOUNT: i128 = 1_000_000_000_000_000;
/// Grace period after `next_renewal_date` during which renewal is allowed.
const RENEWAL_WINDOW: u64 = 604_800; // 7 days

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionMetadata {
    pub service_id: String,
    pub billing_interval: u64,
    pub expected_amount: i128,
    pub next_renewal: u64,
    pub is_active: bool,
    pub encrypted_blob: Bytes,
    pub encrypted_data: Option<String>,
}

/// Lifecycle status for a registered subscription.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubscriptionStatus {
    Active,
    Canceled,
    Expired,
}

/// Core on-chain subscription record.
///
/// Tracks the subscription identity, parties, billing parameters, and
/// renewal schedule required for registration, renewal, and cancellation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscription {
    pub id: BytesN<32>,
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub interval: u64,
    pub next_renewal_date: u64,
    pub created_at: u64,
    pub status: SubscriptionStatus,
    /// Optional linked escrow id used for pending funds cleanup on cancel.
    pub escrow_id: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    UserSubscriptions(Address),
    /// Maps a subscriber to core `Subscription` ids (persistent).
    CoreUserSubscriptions(Address),
    MerchantSubscriptions(Address),
    Subscription(BytesN<32>),
    /// Core `Subscription` records keyed by subscription id.
    CoreSubscription(BytesN<32>),
    SubscriptionCounter,
    CoreSubscriptionCounter,
    Admin,
    /// Tracks whether a pending token allowance remains for a subscription.
    PendingAllowance(BytesN<32>),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionCreatedEvent {
    pub subscription_id: BytesN<32>,
    pub user: Address,
    pub service_id: String,
    pub billing_interval: u64,
    pub expected_amount: i128,
    pub next_renewal: u64,
    pub encrypted_blob: Bytes,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionUpdatedEvent {
    pub subscription_id: BytesN<32>,
    pub user: Address,
    pub service_id: String,
    pub billing_interval: u64,
    pub expected_amount: i128,
    pub next_renewal: u64,
    pub encrypted_blob: Bytes,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionCancelledEvent {
    pub subscription_id: BytesN<32>,
    pub user: Address,
    pub service_id: String,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionRegisteredEvent {
    pub subscription_id: BytesN<32>,
    pub user: Address,
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub next_renewal_date: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionRenewedEvent {
    pub subscription_id: BytesN<32>,
    pub user: Address,
    pub merchant: Address,
    pub amount: i128,
    pub next_renewal_date: u64,
}

#[contract]
pub struct SubscriptionRegistry;

#[contractimpl]
impl SubscriptionRegistry {
    /// Set the contract admin. Callable once.
    pub fn init_admin(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("admin already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    fn is_admin(env: &Env, caller: &Address) -> bool {
        env.storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .map(|admin| &admin == caller)
            .unwrap_or(false)
    }

    /// Register a new subscription and authorize the initial token allowance.
    ///
    /// The subscriber must authorize via `require_auth()`. Payment amount and
    /// billing interval are validated against contract bounds before persistence.
    pub fn register_subscription(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
    ) -> BytesN<32> {
        user.require_auth();

        if user == merchant {
            panic!("user and merchant must differ");
        }
        if amount <= 0 || amount > MAX_AMOUNT {
            panic!("amount out of bounds");
        }
        if interval < MIN_INTERVAL || interval > MAX_INTERVAL {
            panic!("interval out of bounds");
        }

        let now = env.ledger().timestamp();
        let next_renewal_date = now.checked_add(interval).expect("next_renewal_date overflow");

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CoreSubscriptionCounter)
            .unwrap_or(0u64);
        let new_counter = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::CoreSubscriptionCounter, &new_counter);

        let mut id_bytes = [0u8; 32];
        let counter_bytes = counter.to_be_bytes();
        let user_bytes = user.clone().to_xdr(&env);
        id_bytes[..8].copy_from_slice(&counter_bytes);
        let user_hash = env.crypto().sha256(&user_bytes);
        id_bytes[8..32].copy_from_slice(&user_hash.to_array()[..24]);
        // Distinguish core ids from metadata-based ids in the high nibble.
        id_bytes[31] ^= 0xA5;
        let subscription_id = BytesN::from_array(&env, &id_bytes);

        let subscription = Subscription {
            id: subscription_id.clone(),
            user: user.clone(),
            merchant: merchant.clone(),
            token: token.clone(),
            amount,
            interval,
            next_renewal_date,
            created_at: now,
            status: SubscriptionStatus::Active,
            escrow_id: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::CoreSubscription(subscription_id.clone()), &subscription);

        let mut user_subs: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::CoreUserSubscriptions(user.clone()))
            .unwrap_or_else(|| vec![&env]);
        user_subs.push_back(subscription_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::CoreUserSubscriptions(user.clone()), &user_subs);

        let mut merchant_subs: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::MerchantSubscriptions(merchant.clone()))
            .unwrap_or_else(|| vec![&env]);
        merchant_subs.push_back(subscription_id.clone());
        env.storage()
            .persistent()
            .set(
                &DataKey::MerchantSubscriptions(merchant.clone()),
                &merchant_subs,
            );

        // Authorize the contract to pull the first renewal payment via SAC allowance.
        let expiration_ledger = env.ledger().sequence().saturating_add(interval as u32);
        let token_client = token::Client::new(&env, &token);
        token_client.approve(
            &user,
            &env.current_contract_address(),
            &amount,
            &expiration_ledger,
        );
        env.storage()
            .persistent()
            .set(&DataKey::PendingAllowance(subscription_id.clone()), &amount);

        SubscriptionRegisteredEvent {
            subscription_id: subscription_id.clone(),
            user,
            merchant,
            amount,
            interval,
            next_renewal_date,
        }
        .publish(&env);

        subscription_id
    }

    /// Renew an active subscription when the ledger timestamp is inside the
    /// allowed renewal window. Transfers `amount` from the subscriber to the
    /// merchant via the Stellar Asset Contract, then advances `next_renewal_date`.
    pub fn renew_subscription(env: Env, subscription_id: BytesN<32>) {
        let mut subscription: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::CoreSubscription(subscription_id.clone()))
            .unwrap_or_else(|| panic!("subscription not found"));

        if subscription.status != SubscriptionStatus::Active {
            panic!("subscription is not active");
        }

        let now = env.ledger().timestamp();
        if now < subscription.next_renewal_date {
            panic!("renewal window has not opened");
        }
        let window_end = subscription
            .next_renewal_date
            .checked_add(RENEWAL_WINDOW)
            .expect("renewal window overflow");
        if now > window_end {
            panic!("renewal window has closed");
        }

        // Pull funds from subscriber to merchant through the SAC.
        let token_client = token::Client::new(&env, &subscription.token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &subscription.user,
            &subscription.merchant,
            &subscription.amount,
        );

        // Initial allowance from registration has been consumed.
        env.storage()
            .persistent()
            .remove(&DataKey::PendingAllowance(subscription_id.clone()));

        subscription.next_renewal_date = subscription
            .next_renewal_date
            .checked_add(subscription.interval)
            .expect("next_renewal_date overflow");

        env.storage().persistent().set(
            &DataKey::CoreSubscription(subscription_id.clone()),
            &subscription,
        );

        SubscriptionRenewedEvent {
            subscription_id,
            user: subscription.user,
            merchant: subscription.merchant,
            amount: subscription.amount,
            next_renewal_date: subscription.next_renewal_date,
        }
        .publish(&env);
    }

    /// Fetch a core `Subscription` by id.
    pub fn get_core_subscription(env: Env, subscription_id: BytesN<32>) -> Option<Subscription> {
        env.storage()
            .persistent()
            .get(&DataKey::CoreSubscription(subscription_id))
    }

    /// Subscription ids associated with a merchant.
    pub fn get_merchant_subscriptions(env: Env, merchant: Address) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::MerchantSubscriptions(merchant))
            .unwrap_or_else(|| vec![&env])
    }

    /// Core subscription ids associated with a user.
    pub fn get_core_user_subscriptions(env: Env, user: Address) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::CoreUserSubscriptions(user))
            .unwrap_or_else(|| vec![&env])
    }

    /// Create a new subscription for a user
    pub fn create_subscription(
        env: Env,
        user: Address,
        service_id: String,
        billing_interval: u64,
        expected_amount: i128,
        next_renewal: u64,
        encrypted_blob: Bytes,
    ) -> BytesN<32> {
        user.require_auth();
        if billing_interval == 0 {
            panic!("billing_interval must be greater than 0");
        }
        if expected_amount <= 0 {
            panic!("expected_amount must be non-negative");
        }
        if next_renewal == 0 {
            panic!("next_renewal must be greater than 0");
        }

        let mut user_subs: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::UserSubscriptions(user.clone()))
            .unwrap_or_else(|| vec![&env]);

        for sub_id in user_subs.iter() {
            if let Some(meta) = env.storage().instance().get::<_, SubscriptionMetadata>(&DataKey::Subscription(sub_id)) {
                if meta.service_id == service_id && meta.is_active {
                    panic!("duplicate subscription for service");
                }
            }
        }

        // Generate unique subscription ID using counter and user address
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::SubscriptionCounter)
            .unwrap_or(0u64);
        let new_counter = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::SubscriptionCounter, &new_counter);

        // Create deterministic subscription ID from counter and user hash
        let mut id_bytes = [0u8; 32];
        let counter_bytes = counter.to_be_bytes();
        let user_bytes = user.clone().to_xdr(&env);
        id_bytes[..8].copy_from_slice(&counter_bytes);
        let user_hash = env.crypto().sha256(&user_bytes);
        id_bytes[8..32].copy_from_slice(&user_hash.to_array()[..24]);
        let subscription_id = BytesN::from_array(&env, &id_bytes);

        let metadata = SubscriptionMetadata {
            service_id: service_id.clone(),
            billing_interval,
            expected_amount,
            next_renewal,
            is_active: true,
            encrypted_blob: encrypted_blob.clone(),
            encrypted_data: None,
        };
        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscription_id.clone()), &metadata);

        user_subs.push_back(subscription_id.clone());
        env.storage()
            .instance()
            .set(&DataKey::UserSubscriptions(user.clone()), &user_subs);

        SubscriptionCreatedEvent {
            subscription_id: subscription_id.clone(),
            user: user.clone(),
            service_id: service_id.clone(),
            billing_interval,
            expected_amount,
            next_renewal,
            encrypted_blob: encrypted_blob.clone(),
        }
        .publish(&env);

        subscription_id
    }

    /// Update an existing subscription's metadata
    pub fn update_subscription(
        env: Env,
        subscription_id: BytesN<32>,
        user: Address,
        service_id: Option<String>,
        billing_interval: Option<u64>,
        expected_amount: Option<i128>,
        next_renewal: Option<u64>,
        encrypted_blob: Option<Bytes>,
    ) {
        user.require_auth();
        let mut metadata: SubscriptionMetadata = env
            .storage()
            .instance()
            .get(&DataKey::Subscription(subscription_id.clone()))
            .unwrap_or_else(|| panic!("subscription not found"));

        if !metadata.is_active {
            panic!("subscription is not active");
        }

        if let Some(sid) = service_id {
            metadata.service_id = sid;
        }
        if let Some(bi) = billing_interval {
            if bi == 0 {
                panic!("billing_interval must be greater than 0");
            }
            metadata.billing_interval = bi;
        }
        if let Some(ea) = expected_amount {
            if ea <= 0 {
                panic!("expected_amount must be non-negative");
            }
            metadata.expected_amount = ea;
        }
        if let Some(nr) = next_renewal {
            if nr == 0 {
                panic!("next_renewal must be greater than 0");
            }
            metadata.next_renewal = nr;
        }
        if let Some(eb) = encrypted_blob {
            metadata.encrypted_blob = eb;
        }

        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscription_id.clone()), &metadata);

        SubscriptionUpdatedEvent {
            subscription_id: subscription_id.clone(),
            user: user.clone(),
            service_id: metadata.service_id.clone(),
            billing_interval: metadata.billing_interval,
            expected_amount: metadata.expected_amount,
            next_renewal: metadata.next_renewal,
            encrypted_blob: metadata.encrypted_blob.clone(),
        }
        .publish(&env);
    }

    /// Cancel a subscription.
    ///
    /// Only the subscriber or the contract admin may cancel. Core subscriptions
    /// move to `SubscriptionStatus::Canceled` and drop pending allowance /
    /// escrow linkage. Legacy metadata subscriptions are marked inactive.
    pub fn cancel_subscription(env: Env, subscription_id: BytesN<32>, caller: Address) {
        caller.require_auth();

        if let Some(mut subscription) = env
            .storage()
            .persistent()
            .get::<_, Subscription>(&DataKey::CoreSubscription(subscription_id.clone()))
        {
            let authorized =
                caller == subscription.user || Self::is_admin(&env, &caller);
            if !authorized {
                panic!("unauthorized cancellation");
            }
            if subscription.status == SubscriptionStatus::Canceled {
                panic!("subscription already canceled");
            }

            subscription.status = SubscriptionStatus::Canceled;

            // Clean up tracked allowance. When the subscriber cancels, also
            // revoke the SAC allowance so third parties cannot pull funds.
            if env
                .storage()
                .persistent()
                .has(&DataKey::PendingAllowance(subscription_id.clone()))
            {
                if caller == subscription.user {
                    let token_client = token::Client::new(&env, &subscription.token);
                    token_client.approve(
                        &subscription.user,
                        &env.current_contract_address(),
                        &0,
                        &env.ledger().sequence(),
                    );
                }
                env.storage()
                    .persistent()
                    .remove(&DataKey::PendingAllowance(subscription_id.clone()));
            }

            // Drop any linked escrow reference so canceled subs cannot settle.
            subscription.escrow_id = None;

            env.storage().persistent().set(
                &DataKey::CoreSubscription(subscription_id.clone()),
                &subscription,
            );

            SubscriptionCancelledEvent {
                subscription_id,
                user: subscription.user,
                service_id: String::from_str(&env, "core"),
            }
            .publish(&env);
            return;
        }

        let mut metadata: SubscriptionMetadata = env
            .storage()
            .instance()
            .get(&DataKey::Subscription(subscription_id.clone()))
            .unwrap_or_else(|| panic!("subscription not found"));

        if !metadata.is_active {
            panic!("subscription is already cancelled");
        }

        metadata.is_active = false;
        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscription_id.clone()), &metadata);

        SubscriptionCancelledEvent {
            subscription_id: subscription_id.clone(),
            user: caller,
            service_id: metadata.service_id.clone(),
        }
        .publish(&env);
    }

    /// Store encrypted data for a subscription
    pub fn store_encrypted_subscription(
        env: Env,
        subscription_id: BytesN<32>,
        user: Address,
        encrypted_data: String,
    ) {
        user.require_auth();
        let mut metadata: SubscriptionMetadata = env
            .storage()
            .instance()
            .get(&DataKey::Subscription(subscription_id.clone()))
            .unwrap_or_else(|| panic!("subscription not found"));
        
        metadata.encrypted_data = Some(encrypted_data);
        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscription_id), &metadata);
    }

    /// Get subscription metadata by ID
    pub fn get_subscription(env: Env, subscription_id: BytesN<32>) -> Option<SubscriptionMetadata> {
        env.storage()
            .instance()
            .get(&DataKey::Subscription(subscription_id))
    }

    /// Get all subscription IDs for a user
    pub fn get_user_subscriptions(env: Env, user: Address) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&DataKey::UserSubscriptions(user))
            .unwrap_or_else(|| vec![&env])
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{StellarAssetClient, TokenClient},
    };

    fn setup_token(env: &Env) -> (Address, Address, Address, TokenClient<'static>) {
        let admin = Address::generate(env);
        let user = Address::generate(env);
        let merchant = Address::generate(env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token = TokenClient::new(env, &sac.address());
        let asset = StellarAssetClient::new(env, &sac.address());
        asset.mint(&user, &1_000_000_000i128);
        (user, merchant, sac.address(), token)
    }

    #[test]
    fn register_persists_active_subscription() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SubscriptionRegistry, ());
        let client = SubscriptionRegistryClient::new(&env, &contract_id);
        let (user, merchant, token, _) = setup_token(&env);

        let interval = MIN_INTERVAL;
        let amount = 1_000i128;
        let id = client.register_subscription(&user, &merchant, &token, &amount, &interval);

        let sub = client.get_core_subscription(&id).unwrap();
        assert_eq!(sub.status, SubscriptionStatus::Active);
        assert_eq!(sub.amount, amount);
        assert_eq!(sub.interval, interval);
        assert_eq!(sub.user, user);
        assert_eq!(sub.merchant, merchant);
        assert_eq!(client.get_core_user_subscriptions(&user).len(), 1);
        assert_eq!(client.get_merchant_subscriptions(&merchant).len(), 1);
    }

    #[test]
    #[should_panic(expected = "amount out of bounds")]
    fn register_rejects_invalid_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SubscriptionRegistry, ());
        let client = SubscriptionRegistryClient::new(&env, &contract_id);
        let (user, merchant, token, _) = setup_token(&env);
        client.register_subscription(&user, &merchant, &token, &0i128, &MIN_INTERVAL);
    }

    #[test]
    fn renew_transfers_and_advances_next_renewal() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SubscriptionRegistry, ());
        let client = SubscriptionRegistryClient::new(&env, &contract_id);
        let (user, merchant, token, token_client) = setup_token(&env);

        let interval = MIN_INTERVAL;
        let amount = 5_000i128;
        let id = client.register_subscription(&user, &merchant, &token, &amount, &interval);
        let before = client.get_core_subscription(&id).unwrap();

        env.ledger().with_mut(|li| {
            li.timestamp = before.next_renewal_date;
        });

        let merchant_before = token_client.balance(&merchant);
        client.renew_subscription(&id);
        let after = client.get_core_subscription(&id).unwrap();

        assert_eq!(token_client.balance(&merchant), merchant_before + amount);
        assert_eq!(
            after.next_renewal_date,
            before.next_renewal_date + interval
        );
        assert_eq!(after.status, SubscriptionStatus::Active);
    }

    #[test]
    #[should_panic(expected = "renewal window has not opened")]
    fn renew_rejects_early_attempt() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SubscriptionRegistry, ());
        let client = SubscriptionRegistryClient::new(&env, &contract_id);
        let (user, merchant, token, _) = setup_token(&env);
        let id =
            client.register_subscription(&user, &merchant, &token, &1_000i128, &MIN_INTERVAL);
        client.renew_subscription(&id);
    }

    #[test]
    fn cancel_by_subscriber_sets_canceled_and_clears_allowance() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SubscriptionRegistry, ());
        let client = SubscriptionRegistryClient::new(&env, &contract_id);
        let (user, merchant, token, _) = setup_token(&env);
        let id =
            client.register_subscription(&user, &merchant, &token, &1_000i128, &MIN_INTERVAL);

        client.cancel_subscription(&id, &user);
        let sub = client.get_core_subscription(&id).unwrap();
        assert_eq!(sub.status, SubscriptionStatus::Canceled);
        assert!(sub.escrow_id.is_none());
    }

    #[test]
    fn cancel_by_admin_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SubscriptionRegistry, ());
        let client = SubscriptionRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init_admin(&admin);

        let (user, merchant, token, _) = setup_token(&env);
        let id =
            client.register_subscription(&user, &merchant, &token, &1_000i128, &MIN_INTERVAL);

        client.cancel_subscription(&id, &admin);
        let sub = client.get_core_subscription(&id).unwrap();
        assert_eq!(sub.status, SubscriptionStatus::Canceled);
    }

    #[test]
    #[should_panic(expected = "unauthorized cancellation")]
    fn cancel_by_third_party_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SubscriptionRegistry, ());
        let client = SubscriptionRegistryClient::new(&env, &contract_id);
        let (user, merchant, token, _) = setup_token(&env);
        let id =
            client.register_subscription(&user, &merchant, &token, &1_000i128, &MIN_INTERVAL);
        let stranger = Address::generate(&env);
        client.cancel_subscription(&id, &stranger);
    }
}
