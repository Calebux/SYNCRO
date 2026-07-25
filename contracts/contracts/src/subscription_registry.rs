use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, vec, xdr::ToXdr, Address, Bytes, BytesN, Env,
    String, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionMetadata {
    pub service_id: String,
    pub billing_interval: u64,
    pub expected_amount: i128,
    pub next_renewal: u64,
    pub is_active: bool,
    pub encrypted_blob: Bytes,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    UserSubscriptions(Address),
    Subscription(BytesN<32>),
    SubscriptionCounter,
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

#[contract]
pub struct SubscriptionRegistry;

#[contractimpl]
impl SubscriptionRegistry {
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

    /// Cancel a subscription by marking it as inactive
    pub fn cancel_subscription(env: Env, subscription_id: BytesN<32>, user: Address) {
        user.require_auth();
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
            user: user.clone(),
            service_id: metadata.service_id.clone(),
        }
        .publish(&env);
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
