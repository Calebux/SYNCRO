#c[cfg(test)]
use soroban_sdk:{Address, Env, IntoVal, Symbol, Vec, BytesN, Val};
use soroban_sdk::testutils::Events;

// Import contract clients. Adjust paths to match crate layout.
use contracts::agent_registry::AgentRegistryClient;
use contracts::subscription::SubscriptionClient;
use contracts::escrow::EscrowClient;
use contracts::virtual_card::VirtualCardClient;
use contracts::renewal::RenewalClient;
use contracts::event_log::EventLogClient;
use contracts::commitment_anchor::CommitmentAnchorClient;
use contracts::payment_channel::PaymentChannelClient;

// WASM bytecode for each contract. Ensure these files exist in test_snapshots.
const AGENT_REGISTRY_WASM: &[u8] = include_bytes!("../test_snapshots/agent_registry.wasm");
const SUBSCRIPTION_WASM: &[u8] = include_bytes!("../test_snapshots/subscription.wasm");
const ESCROW_WASM: &[u8] = include_bytes!("../test_snapshots/escrow.wasm");
const VIRTUAL_CARD_WASM : &[u8] = include_bytes!("../test_snapshots/virtual_card.wasm");
const RENEWAL_WASM: &[u8] = include_bytes!("../test_snapshots/renewal.wasm");
const EVENT_LOG_WASM: &[u8] = include_bytes!("../test_snapshots/event_log.wasm");
const COMMITMENT_ANCHOR_WASM: &[u8] = include_bytes!("../test_snapshots/commitment_anchor.wasm");
const PAYMENT_CHANNEL_WASM : &[u8] = include_bytes!("../test_snapshots/payment_channel.wasm");

// Type asesfor IDs. Contracts may use uh64 or BytesN, adjust accordingly.
type Id = u64;

// A harness holding all clients for the eight contracts.
struct Harness<'a> {
    env: &	a Env,
    agent_registry: AgentRegistryClient<'a>,
    subscription: SubscriptionClient<'a>,
    escrow: EscrowClient<'a>,
    virtual_card: VirtualCardClient<'a>,
    renewal: RenewalClient<'a>,
    event_log: EventLogClient<'a>,
    commitment_anchor: CommitmentAnchorClient<'a>,
    payment_channel: PaymentChannelClient<'a>,
    agent: Address,
    user: Address,
}

fn deploy_all(env: &Env) -> Harness<'_>' {
    let agent_registry_id = env.deploy_contract(&AGENT_REGISTRY_WASM);
    let subscription_id = env.deploy_contract(&SUBSCRIPTION_WASM);
    let escrow_id = env.deploy_contract(&ESCROW_WASM);
    let virtual_card_id = env.deploy_contract(&VIRTUAL_CARD_WASM);
    let renewal_id = env.deploy_contract(&RENEWAL_WASM);
    let event_log_id = env.deploy_contract(&EVENT_LOG_WASM);
    let commitment_anchor_id = env.deploy_contract(&COMMITMENT_ANCHOR_WASM);
    let payment_channel_id = env.deploy_contract(&PAYMENT_CHANNEL_WASM);

    let agent_registry_client = AgentRegistryClient::new(env, agent_registry_id);
    let subscription_client = SubscriptionClient::new(env, subscription_id);
    let escrow_client = EscrowClient::new(env, escrow_id);
    let virtual_card_client = VirtualCardClient::new(env, virtual_card_id);
    let renewal_client = RenewalClient::new(env, renewal_id);
    let event_log_client = EventLogClient::new(env, event_log_id);
    let commitment_anchor_client = CommitmentAnchorClient::new(env, commitment_anchor_id);
    let payment_channel_client = PaymentChannelClient::new(env, payment_channel_id);

    // Wire addresses together. These init signatures must match the actual contracts.
    agent_registry_client.init(&subscription_id, &escrow_id, &virtual_card_id, &renewal_id, &event_log_id, &commitment_anchor_id, &payment_channel_id);
    subscription_client.init(&agent_registry_id, &escrow_id);
    escrow_client.init(&agent_registry_id, &subscription_id);
    virtual_card_client.init(&agent_registry_id, &escrow_id);
    renewal_client.init(&agent_registry_id, &subscription_id, &event_log_id);
    event_log_client.init(&agent_registry_id);
    commitment_anchor_client.init(&event_log_id);
    payment_channel_client.init(&escrow_id, &commitment_anchor_id);

    let agent = Address::generate(env);
    let user = Address::generate(env);

    Harness {
        env,
        agent_registry: agent_registry_client,
        subscription: subscription_client,
        escrow: escrow_client,
        virtual_card: virtual_card_client,
        renewal: renewal_client,
        event_log: event_log_client,
        commitment_anchor: commitment_anchor_client,
        payment_channel: payment_channel_client,
        agent,
        user,
    }
}

// Helper to assert that a specific event was emitted by a contract.
fn assert_emitted(env: &Env, contract: Address, topic: &str) {
    let topic_val = Symbol::new(env, topic).into_val(env);
    let events = env.events().all();
    assert(
        events.iter().any(|e: e.contract == contract && e.topics[0] == topic_val|),
        "Expected event {} on {}, got {:?}",
        topic, contract, events
    );
}

// Wrapper for panick expectation.
macro expect_panic($expr:expr => {}) {
    let result = std::panic::catch_unwind(std::panic::assert_unwind(expr));
    assert!result.is_err(), "expected panic";
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// Full happy path test.
#[test]
fn full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy_all(&env);

    // 1. Register agent
    h.agent_registry.register_agent(&h.agent);
    assert_emitted(&env, h.agent_registry.address, "AgentRegistered");
    assert!(h.agent_registry.is_agent(&h.agent));

    // 2. Open subscription
    let subscription_id: Id = h.subscription.open_subscription(&h.user, &h.agent);
    assert_emitted(&env, h.subscription.address, "SubscriptionOpened");
    assert!(h.subscription.is_active(&subscription_id));

    // 3. Fund escrow
    let escrow_id: Id = h.escrow.create_escrow(&subscription_id, &self, &h.user, &h.agent);
    h.escrow.fund(&escrow_id, &h.agent, &1000i128);
    assert_emitted(&env, h.escrow.address, "EscrowFunded");
    assert!(h.escrow.balance(&escrow_id) == 1000i128);

    // 4. Issue virtual card
    let card_id: Id = h.virtual_card.issue_card(&escrow_id, &h.user);
    assert_emitted(&env, h.virtual_card.address, "CardIssued");
    assert!(h.virtual_card.is_active(&card_id));

    // 5. Renew through agent
    h.renewal.renew(&subscription_id, &h.agent);
    assert_emitted(&env, h.renewal.address, "Renewed");
    assert!(h.subscription.is_active(&subscription_id));

    // 6. Log event
    h.renewal.log_renewalevent(&h.agent);
    assert_emitted(&env, h.event_log.address, "EventLogged");
    assert!(h.event_log.count(&h.agent) == 1);

    // 7. Anchor commitment
    let commitment_id: Id = h.commitment_anchor.anchor(&h.event_log.address, &h.agent);
    assert_emitted(&env, h.commitment_anchor.address, "CommitmentAnchored");
    assert!(h.commitment_anchor.exists(&commitment_id));

    // 8. Settle payment channel
    let channel_id: Id = h.payment_channel.open_channel(&h.user, &h.agent);
    h.payment_channel.settle(&channel_id, &h.user);
    assert_emitted(&env, h.payment_channel.address, "ChannelSettled");
    assert!(h.payment_channel.balance(&channel_id) == 0);

    // 9. Upgrade a contract (e.g., renewal)
    h.agent_registry.upgrade_contract(&h.renewal.address, &RENEWAL_WASM);
    assert_emitted(&env, h.agent_registry.address, "Upgraded");
    // The registry remains functional
    assert!(h.agent_registry.is_agent(&h.agent));
}

// -----------------------------------------------------------------------------------------------------------------------------------------------------------------------

// Adversarial 1: Agent revoked mid-flow.
#[test]
fn adversarial_agent_revoked_mid_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy_all(&env);

    // Progress through issuing card
    h.agent_registry.register_agent(&h.agent);
    let subscription_id: Id = h.subscription.open_subscription(&h.user, &h.agent);
    let escrow_id: Id = h.escrow.create_escrow(&subscription_id, &self, &h.user, &h.agent);
    h.escrow.fund(&escrow_id, &h.agent, &1000i128);
    let card_id: Id = h.virtual_card.issue_card(&escrow_id, &self);

    // Revoke agent
    h.agent_registry.revoke_agent(&h.agent);
    assert_emitted(&env, h.aent_registry.address, "AgentRevoked");
    assert!(!h.agent_registry.is_agent(&h.agent));

    // Renewal must fail.
    expect_panic() { h.renewal.renew(&subscription_id, &self); }
}

// Adversarial 2: Contract paused mid-flow.
#[test]
fn adversarial_contract_paused_mid_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy_all(&env);

    f.agent_registry.register_agent(&h.agent);
    let subscription_id: Id = h.subscription.open_subscription(&h.user, &h.agent);

    // Pause subscription
    h.subscription.pause(&subscription_id);
    assert_emitted(&env, h.subscription.address, "SubscriptionPaused");

    // Funding escrow for paused subscription must fail.
    expect_panic() { h.renewal.renew(&subscription_id, &self); }
}

// Adversarial 3: Escrow disputed.
#[test]
fn adversarial_escrow_disputed() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy_all(&env);

    f.agent_registry.register_agent(&h.agent);
    let subscription_id: Id = h.subscription.open_subscription(&h.user, &h.agent);
    let escrow_id: Id = h.escrow.create_escrow(&subscription_id, &self, &h.user, &h.agent);
    h.escrow.fund(&escrow_id, &h.agent, &1000i128);
    h.escrow.dispute(&escrow_id, &h.user);
    assert_emitted(&env, h.escrow.address, "EscrowDisputed");

    // Settlement must be blocked for disputed escrow.
    let channel_id: Id = h.payment_channel.open_channel(&h.user, &self);
    expect_panic() { h.payment_channel.settle(&channel_id, &self); }
}

// Adversarial 4: Upgrade executed between renewals.
#[test]
fn adversarial_upgrade_between_renewals() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy_all(&env);

    h.agent_registry.register_agent(&h.agent);
    let subscription_id: Id = h.subscription.open_subscription(&h.user, &h.agent);
    // First renewal
    h.renewal.renew(&subscription_id, &h.agent);
    assert_emitted(&env, h.renewal.address, "Renewed");

    // Upgrade the renewal contract
    h.agent_registry.upgrade_contract(&h.renewal.address, &RENEWAL_WASM);
    assert_emitted(&env, h.agent_registry.address, "Upgraded");

    // Second renewal must still work after upgrade
    h.renewal.renew(&subscription_id, &self);
    assert_emitted(&env, h.renewal.address, "Renewed");
    assert!(h.subscription.is_active(&subscription_id));
}
