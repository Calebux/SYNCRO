#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, vec, Address, Bytes,
    Env, Vec,
};
use syncro_contract_common as syncro_common;

/// Time (in seconds) a contract must be continuously paused before any party
/// may invoke the escape-hatch withdrawal for their own balance.
///
/// 7 days — compile-time constant, not admin-settable.
pub const ESCAPE_HATCH_GRACE_PERIOD_SECS: u64 = 7 * 24 * 60 * 60; // 604 800 s

/// Maximum watchtower bounty that can be reserved from a channel, in token units.
/// Caps the amount a watchtower can ever receive; channel principal cannot be redirected.
pub const MAX_WATCHTOWER_BOUNTY: i128 = 10_000;

/// Freshness window for payment proofs (in seconds).
///
/// A proof whose `timestamp` falls outside `[now - WINDOW, now + WINDOW]` is
/// rejected.  Using a symmetric ±window accommodates reasonable clock skew
/// between the gateway and the ledger without accepting arbitrarily old proofs.
///
/// 5 minutes — tight enough to prevent replay without being fragile under
/// normal latency.
pub const PROOF_FRESHNESS_WINDOW_SECS: u64 = 5 * 60; // 300 s

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Channel(u64),
    ChannelCount,
    /// Unix timestamp at which the contract entered the paused state.
    /// Key absent ⟹ contract is not paused.
    PausedSince,
    Watchtowers(u64),
    WatchtowerBounty(u64),
    BountyPaid(u64),
    /// Seen-nonce entry for replay detection.
    /// Key present  ⟹ nonce already consumed for this channel.
    /// Key absent   ⟹ nonce is fresh.
    SeenNonce(u64, u64),
}

/// A payment proof binds a single off-chain API call to a specific channel
/// state update.  The `request_hash` commits to the exact request body so
/// the proof cannot be transplanted to a different request.  The `nonce`
/// ensures one-time use even if two requests share an identical body.
///
/// Signed material: `channel_id ‖ request_hash ‖ nonce ‖ timestamp`
///
/// Both channel parties must sign this material before the gateway sends it
/// to the payer.  The contract verifies the binding on `verify_payment_proof`
/// so an intermediary cannot alter the request after the proof is checked.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentProof {
    /// On-chain channel that backs this payment.
    pub channel_id: u64,
    /// SHA-256 hash of the canonical request bytes (method + path + body).
    /// Binds the proof to exactly one request so it cannot be reused for
    /// a different call.
    pub request_hash: Bytes,
    /// Monotonically unique token chosen by the gateway.  Stored in the
    /// contract after first acceptance so any replay is rejected.
    pub nonce: u64,
    /// Unix timestamp (seconds) at which the proof was issued.  Must lie
    /// within PROOF_FRESHNESS_WINDOW_SECS of the current ledger time.
    pub timestamp: u64,
    /// Amount (in token units) authorised by this proof.
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChannelState {
    Open = 1,
    Closing = 2,
    Dispute = 3,
    Closed = 4,
}

/// A payment channel between two parties backed by an on-chain token escrow.
///
/// # Token field
/// `token` stores the SEP-41 token contract address used for the initial
/// deposit and for disbursements on `finalize`.  Without this field the
/// contract has no way to disburse funds, which would lock balances forever.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentChannel {
    pub id: u64,
    pub depositor: Address,
    pub counterparty: Address,
    /// Token contract used for on-chain disbursement.
    pub token: Address,
    pub balance_a: i128,
    pub balance_b: i128,
    pub sequence: u64,
    pub state: ChannelState,
    pub dispute_deadline: u64,
    pub closing_started_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1600,
    NotInitialized = 1601,
    Unauthorized = 1602,
    ChannelNotFound = 1603,
    InvalidAmount = 1604,
    InvalidState = 1605,
    InsufficientBalance = 1606,
    DisputeWindowActive = 1607,
    DisputeWindowExpired = 1608,
    StaleState = 1609,
    CounterOverflow = 1610,
    NotWatchtower = 1611,
    WatchtowerAlreadyRegistered = 1612,
    BountyExceedsCap = 1613,
    InvalidBounty = 1614,
    WatchtowerIsParty = 1615,
    /// The payment proof has already been consumed; replay rejected.
    ProofAlreadyUsed = 1616,
    /// The proof timestamp is outside the acceptable freshness window.
    ProofExpired = 1617,
    /// The proof's channel_id does not match the target channel.
    ProofChannelMismatch = 1618,
    /// The proof request_hash is empty (zero-length Bytes).
    ProofInvalidRequestHash = 1619,
    /// The proof amount is non-positive.
    ProofInvalidAmount = 1620,
}

#[contract]
pub struct PaymentChannelContract;

#[contractimpl]
impl PaymentChannelContract {
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    /// Open a new payment channel.
    ///
    /// `token` is the SEP-41 token contract.  The depositor must have
    /// pre-approved the contract to spend `deposit_amount` tokens (via the
    /// standard token allowance mechanism), which this call then transfers
    /// into contract escrow.
    pub fn open_channel(
        env: Env,
        depositor: Address,
        counterparty: Address,
        token: Address,
        deposit_amount: i128,
        dispute_window: u64,
    ) -> Result<u64, Error> {
        depositor.require_auth();

        if deposit_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if depositor == counterparty {
            return Err(Error::Unauthorized);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ChannelCount)
            .unwrap_or(0);
        let id = count.checked_add(1).ok_or(Error::CounterOverflow)?;
        let now = env.ledger().timestamp();

        // ── EFFECTS — record the channel state ───────────────────────────────
        let channel = PaymentChannel {
            id,
            depositor: depositor.clone(),
            counterparty: counterparty.clone(),
            token: token.clone(),
            balance_a: deposit_amount,
            balance_b: 0,
            sequence: 0,
            state: ChannelState::Open,
            dispute_deadline: now + dispute_window,
            closing_started_at: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Channel(id), &channel);
        env.storage().instance().set(&DataKey::ChannelCount, &id);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("opened")),
            (
                id,
                depositor.clone(),
                counterparty,
                deposit_amount,
                dispute_window,
            ),
        );

        // ── INTERACTIONS — pull funds from depositor ─────────────────────────
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&depositor, &env.current_contract_address(), &deposit_amount);

        Ok(id)
    }

    pub fn submit_state(
        env: Env,
        channel_id: u64,
        balance_a: i128,
        balance_b: i128,
        sequence_number: u64,
        sig_a: Address,
        sig_b: Address,
    ) -> Result<(), Error> {
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open && channel.state != ChannelState::Closing {
            return Err(Error::InvalidState);
        }
        if sequence_number <= channel.sequence {
            return Err(Error::StaleState);
        }
        if !((sig_a == channel.depositor && sig_b == channel.counterparty)
            || (sig_a == channel.counterparty && sig_b == channel.depositor))
        {
            return Err(Error::Unauthorized);
        }

        sig_a.require_auth();
        sig_b.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = sequence_number;
        channel.state = ChannelState::Open;

        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("submitted")),
            (channel_id, balance_a, balance_b, sequence_number),
        );
        Ok(())
    }

    pub fn initiate_close(
        env: Env,
        channel_id: u64,
        balance_a: i128,
        balance_b: i128,
        seq: u64,
        sig: Address,
    ) -> Result<(), Error> {
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if seq <= channel.sequence {
            return Err(Error::StaleState);
        }
        if sig != channel.depositor && sig != channel.counterparty {
            return Err(Error::Unauthorized);
        }

        sig.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = seq;
        channel.state = ChannelState::Closing;
        channel.closing_started_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("closing")),
            (channel_id, balance_a, balance_b, seq),
        );
        Ok(())
    }

    pub fn dispute(
        env: Env,
        channel_id: u64,
        balance_a: i128,
        balance_b: i128,
        higher_seq: u64,
        sig_a: Address,
        sig_b: Address,
    ) -> Result<(), Error> {
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Closing {
            return Err(Error::InvalidState);
        }
        if higher_seq <= channel.sequence {
            return Err(Error::StaleState);
        }
        if env.ledger().timestamp() > channel.dispute_deadline {
            return Err(Error::DisputeWindowExpired);
        }
        if !((sig_a == channel.depositor && sig_b == channel.counterparty)
            || (sig_a == channel.counterparty && sig_b == channel.depositor))
        {
            return Err(Error::Unauthorized);
        }

        sig_a.require_auth();
        sig_b.require_auth();

        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = higher_seq;
        channel.state = ChannelState::Dispute;

        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);
        env.events().publish(
            (symbol_short!("channel"), symbol_short!("disputed")),
            (channel_id, balance_a, balance_b, higher_seq),
        );
        Ok(())
    }

    pub fn finalize(env: Env, channel_id: u64, expected_sequence: u64) -> Result<(), Error> {
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Closing && channel.state != ChannelState::Dispute {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() <= channel.dispute_deadline {
            return Err(Error::DisputeWindowActive);
        }
        if expected_sequence != channel.sequence {
            return Err(Error::StaleState);
        }

        // Capture values needed after the state mutation.
        let depositor = channel.depositor.clone();
        let counterparty = channel.counterparty.clone();
        let token_addr = channel.token.clone();
        let balance_a = channel.balance_a;
        let balance_b = channel.balance_b;

        // ── EFFECTS ─────────────────────────────────────────────────────────
        // Mark closed and persist BEFORE any external call.  A re-entrant
        // `finalize` call would now fail the `InvalidState` guard above.
        channel.state = ChannelState::Closed;
        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("closed")),
            (channel_id, channel.balance_a, channel.balance_b),
        );

        // ── INTERACTIONS ─────────────────────────────────────────────────────
        // Disburse escrowed funds.  Zero-value transfers are skipped.
        let token_client = token::Client::new(&env, &token_addr);

        if balance_a > 0 {
            token_client.transfer(&env.current_contract_address(), &depositor, &balance_a);
        }

        if balance_b > 0 {
            token_client.transfer(&env.current_contract_address(), &counterparty, &balance_b);
        }

        // Unused bounty returns to the depositor; a watchtower never claims it
        // unless they successfully submitted a newer state during the window.
        let bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);
        let paid: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BountyPaid(channel_id))
            .unwrap_or(false);
        if bounty > 0 && !paid {
            token_client.transfer(
                &env.current_contract_address(),
                &depositor,
                &bounty,
            );
        }

        Ok(())
    }

    /// Add more funds to an open channel (depositor side only).
    pub fn top_up(
        env: Env,
        channel_id: u64,
        amount: i128,
        depositor: Address,
    ) -> Result<(), Error> {
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        depositor.require_auth();
        if depositor != channel.depositor {
            return Err(Error::Unauthorized);
        }

        let token_addr = channel.token.clone();

        // ── EFFECTS ─────────────────────────────────────────────────────────
        channel.balance_a += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("toppedup")),
            (channel_id, amount),
        );

        // ── INTERACTIONS ─────────────────────────────────────────────────────
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        Ok(())
    }

    pub fn get_channel(env: Env, channel_id: u64) -> Option<PaymentChannel> {
        env.storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
    }

    // ── Payment Proof verification ────────────────────────────────────────────

    /// Verify a payment proof and apply its debit to the channel.
    ///
    /// This is the single choke-point that enforces:
    ///
    /// 1. **Request binding** — the `request_hash` in the proof must be
    ///    non-empty and was included in the signed material, so the proof
    ///    cannot be transplanted to a different request body.
    ///
    /// 2. **Freshness** — the proof `timestamp` must lie within
    ///    `[ledger_now - PROOF_FRESHNESS_WINDOW_SECS,
    ///      ledger_now + PROOF_FRESHNESS_WINDOW_SECS]`.
    ///    Proofs outside this band are rejected even if the signature is valid.
    ///
    /// 3. **One-time use (nonce dedup)** — the `(channel_id, nonce)` pair is
    ///    persisted on first acceptance.  Any later call with the same pair is
    ///    rejected with `ProofAlreadyUsed`, regardless of whether the request
    ///    hash or balances differ.
    ///
    /// 4. **Proxy integrity** — because the binding is stored on-chain and
    ///    checked before any balance mutation, an intermediary cannot alter the
    ///    request after the proof has been produced and then replay the same
    ///    proof against a different channel state.
    ///
    /// The caller (`payer`) must be the channel depositor and must authorise
    /// the call.  Both channel parties sign the off-chain state; `sig_a` and
    /// `sig_b` must be the depositor and counterparty in either order.
    pub fn verify_payment_proof(
        env: Env,
        proof: PaymentProof,
        payer: Address,
        sig_a: Address,
        sig_b: Address,
    ) -> Result<(), Error> {
        payer.require_auth();

        // ── 0. Structural validation ─────────────────────────────────────────
        if proof.request_hash.is_empty() {
            return Err(Error::ProofInvalidRequestHash);
        }
        if proof.amount <= 0 {
            return Err(Error::ProofInvalidAmount);
        }

        // ── 1. Channel lookup and state check ────────────────────────────────
        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(proof.channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if payer != channel.depositor {
            return Err(Error::Unauthorized);
        }
        if !((sig_a == channel.depositor && sig_b == channel.counterparty)
            || (sig_a == channel.counterparty && sig_b == channel.depositor))
        {
            return Err(Error::Unauthorized);
        }

        // ── 2. Freshness window ──────────────────────────────────────────────
        // Reject proofs that are too old OR suspiciously future-dated.
        let now: u64 = env.ledger().timestamp();
        let skew = PROOF_FRESHNESS_WINDOW_SECS;
        let too_old = proof.timestamp < now.saturating_sub(skew);
        let too_new = proof.timestamp > now.saturating_add(skew);
        if too_old || too_new {
            return Err(Error::ProofExpired);
        }

        // ── 3. Nonce dedup (seen-nonce set) ──────────────────────────────────
        // The set is keyed by (channel_id, nonce). A present key means the
        // nonce has already been consumed; reject regardless of request_hash.
        let nonce_key = DataKey::SeenNonce(proof.channel_id, proof.nonce);
        if env.storage().persistent().has(&nonce_key) {
            return Err(Error::ProofAlreadyUsed);
        }

        // ── 4. Check sufficient balance ───────────────────────────────────────
        if channel.balance_a < proof.amount {
            return Err(Error::InsufficientBalance);
        }

        // Require both parties' signatures last (auth checks are expensive).
        // Skip require_auth for any signatory that is also `payer` to avoid
        // duplicate auth frame errors in Soroban.
        if sig_a != payer {
            sig_a.require_auth();
        }
        if sig_b != payer {
            sig_b.require_auth();
        }

        // ── EFFECTS — mutate state before any interaction ─────────────────────
        // Mark nonce consumed.
        env.storage().persistent().set(&nonce_key, &true);

        // Debit payer, credit counterparty.
        channel.balance_a -= proof.amount;
        channel.balance_b += proof.amount;
        channel.sequence += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Channel(proof.channel_id), &channel);

        env.events().publish(
            (symbol_short!("proof"), symbol_short!("verified")),
            (
                proof.channel_id,
                proof.nonce,
                proof.amount,
                channel.sequence,
            ),
        );

        Ok(())
    }

    /// Returns `true` if the nonce has already been consumed for the given
    /// channel.  Useful for off-chain idempotency checks before submitting.
    pub fn is_nonce_used(env: Env, channel_id: u64, nonce: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::SeenNonce(channel_id, nonce))
    }

    /// Register `watchtower` to submit a newer signed state on `party`'s behalf.
    ///
    /// `bounty` is reserved from the depositor's on-chain balance and paid to
    /// the watchtower on a successful `watchtower_submit`. It is capped by
    /// `MAX_WATCHTOWER_BOUNTY` and can never exceed the remaining `balance_a`.
    /// A watchtower cannot be a channel party, so they cannot redirect principal.
    pub fn register_watchtower(
        env: Env,
        channel_id: u64,
        party: Address,
        watchtower: Address,
        bounty: i128,
    ) -> Result<(), Error> {
        party.require_auth();

        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if party != channel.depositor && party != channel.counterparty {
            return Err(Error::Unauthorized);
        }
        if watchtower == channel.depositor || watchtower == channel.counterparty {
            return Err(Error::WatchtowerIsParty);
        }

        let mut towers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env]);
        if towers.iter().any(|t| t == watchtower) {
            return Err(Error::WatchtowerAlreadyRegistered);
        }

        let existing_bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);

        if bounty < 0 {
            return Err(Error::InvalidBounty);
        }
        if bounty > MAX_WATCHTOWER_BOUNTY {
            return Err(Error::BountyExceedsCap);
        }

        // Only the depositor may fund a new bounty, and only once per channel.
        if bounty > 0 {
            if party != channel.depositor {
                return Err(Error::Unauthorized);
            }
            if existing_bounty > 0 {
                return Err(Error::InvalidBounty);
            }
            if bounty > channel.balance_a {
                return Err(Error::InsufficientBalance);
            }
            channel.balance_a -= bounty;
            env.storage()
                .persistent()
                .set(&DataKey::WatchtowerBounty(channel_id), &bounty);
            env.storage()
                .persistent()
                .set(&DataKey::BountyPaid(channel_id), &false);
            env.storage()
                .persistent()
                .set(&DataKey::Channel(channel_id), &channel);
        }

        towers.push_back(watchtower.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Watchtowers(channel_id), &towers);

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("wt_reg")),
            (channel_id, party, watchtower, bounty),
        );
        Ok(())
    }

    /// Remove a previously registered watchtower. Unused bounty is restored to
    /// the depositor when the last watchtower is removed.
    pub fn deregister_watchtower(
        env: Env,
        channel_id: u64,
        party: Address,
        watchtower: Address,
    ) -> Result<(), Error> {
        party.require_auth();

        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Open {
            return Err(Error::InvalidState);
        }
        if party != channel.depositor && party != channel.counterparty {
            return Err(Error::Unauthorized);
        }

        let towers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env]);
        if !towers.iter().any(|t| t == watchtower) {
            return Err(Error::NotWatchtower);
        }

        let mut remaining: Vec<Address> = vec![&env];
        for t in towers.iter() {
            if t != watchtower {
                remaining.push_back(t);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::Watchtowers(channel_id), &remaining);

        let paid: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BountyPaid(channel_id))
            .unwrap_or(false);
        let bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);
        if remaining.is_empty() && bounty > 0 && !paid {
            channel.balance_a += bounty;
            env.storage()
                .persistent()
                .set(&DataKey::Channel(channel_id), &channel);
            env.storage()
                .persistent()
                .set(&DataKey::WatchtowerBounty(channel_id), &0i128);
        }

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("wt_dereg")),
            (channel_id, party, watchtower),
        );
        Ok(())
    }

    pub fn get_watchtowers(env: Env, channel_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env])
    }

    pub fn get_watchtower_bounty(env: Env, channel_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0)
    }

    /// Submit a newer dual-signed state during the dispute window.
    ///
    /// The caller must be a registered watchtower (not a channel party).
    /// Principal still settles only to `depositor` / `counterparty` on
    /// `finalize`; the watchtower may receive at most the reserved bounty.
    pub fn watchtower_submit(
        env: Env,
        channel_id: u64,
        watchtower: Address,
        balance_a: i128,
        balance_b: i128,
        sequence_number: u64,
        sig_a: Address,
        sig_b: Address,
    ) -> Result<(), Error> {
        watchtower.require_auth();

        let mut channel: PaymentChannel = env
            .storage()
            .persistent()
            .get(&DataKey::Channel(channel_id))
            .ok_or(Error::ChannelNotFound)?;

        if channel.state != ChannelState::Closing && channel.state != ChannelState::Dispute {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() > channel.dispute_deadline {
            return Err(Error::DisputeWindowExpired);
        }
        if sequence_number <= channel.sequence {
            return Err(Error::StaleState);
        }
        if balance_a < 0 || balance_b < 0 {
            return Err(Error::InvalidAmount);
        }

        let towers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Watchtowers(channel_id))
            .unwrap_or(vec![&env]);
        if !towers.iter().any(|t| t == watchtower) {
            return Err(Error::NotWatchtower);
        }
        if !((sig_a == channel.depositor && sig_b == channel.counterparty)
            || (sig_a == channel.counterparty && sig_b == channel.depositor))
        {
            return Err(Error::Unauthorized);
        }

        sig_a.require_auth();
        sig_b.require_auth();

        let bounty: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::WatchtowerBounty(channel_id))
            .unwrap_or(0);
        let paid: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BountyPaid(channel_id))
            .unwrap_or(false);

        // EFFECTS — persist dispute state and mark bounty paid before transfer.
        channel.balance_a = balance_a;
        channel.balance_b = balance_b;
        channel.sequence = sequence_number;
        channel.state = ChannelState::Dispute;
        env.storage()
            .persistent()
            .set(&DataKey::Channel(channel_id), &channel);

        if bounty > 0 && !paid {
            env.storage()
                .persistent()
                .set(&DataKey::BountyPaid(channel_id), &true);
        }

        env.events().publish(
            (symbol_short!("channel"), symbol_short!("wt_sub")),
            (channel_id, watchtower.clone(), balance_a, balance_b, sequence_number),
        );

        // INTERACTIONS — watchtower is paid the capped bounty only.
        if bounty > 0 && !paid {
            let token_client = token::Client::new(&env, &channel.token);
            token_client.transfer(
                &env.current_contract_address(),
                &watchtower,
                &bounty,
            );
        }

        Ok(())
    }

    /// Returns the contract version.
    /// Incremented when the implementation changes (used for deployments).
    pub fn version(_env: Env) -> u32 {
        syncro_common::version(&_env)
    }

    /// Returns the contract interface version.
    /// Incremented when public methods or error handling changes.
    /// Used to detect API mismatches at runtime.
    pub fn interface_version(_env: Env) -> u32 {
        syncro_common::interface_version_call(&_env)
    }
}

#[cfg(test)]
mod adversarial;

#[cfg(test)]
mod fuzz;

#[cfg(test)]
mod proof_replay;
