//! # syncro-channel-state
//!
//! **no_std-friendly** encoding for Syncro v3 channel states.
//!
//! ## Why this crate exists
//!
//! The [`payment-channel`] contract encodes channel-state digests in Rust.
//! The TypeScript settlement layer encodes the same states.  Previously, these
//! two implementations existed independently and had to be kept in sync by
//! convention — a source of subtle, hard-to-detect bugs.
//!
//! This crate is the **single source of truth** for the encoding.  Both the
//! payment-channel contract (via a dev-dependency for vector tests) and the
//! Rust paid-client crate depend on it.  The TypeScript side is verified against
//! the same test vectors (see `tests/vectors/channel-state-vectors.json`).
//!
//! ## Encoding format (v3)
//!
//! ```text
//! v3-channel-state|{contractVersion}|{contractAddress}|{channelId}|{nonce}|{payerBalance}|{payeeBalance}|{windowStart}|{windowEnd}
//! ```
//!
//! * Fields are separated by `|`.
//! * `contractVersion` and `contractAddress` come first so that a state signed
//!   for contract V1 at address A cannot be replayed against V2 or a different
//!   address.
//! * `payerBalance` / `payeeBalance` are unsigned decimal strings of the raw
//!   token-unit amounts (matching [`encodeBalance`] in `@syncro/shared`).
//! * `windowStart` / `windowEnd` are millisecond Unix timestamps as decimal
//!   strings.
//!
//! ## Signing
//!
//! Signature = HMAC-SHA-256(key, encoded_string), hex-encoded.  The signer
//! operates on the **plain encoded string**, not its SHA-256 hash, matching the
//! `HmacChannelStateSigner` in `@syncro/settlement`.
//!
//! ## `no_std` compatibility
//!
//! * The crate is `#![no_std]` with `extern crate alloc` for heap allocation.
//! * The `signing` feature (enabled by default) adds `sha2` + `hmac`, both of
//!   which support `no_std`.
//! * Set `default-features = false` and omit the `signing` feature if you only
//!   need encoding without hashing/signing (e.g. inside a Soroban contract).

#![no_std]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use alloc::format;

// ── Core data type ────────────────────────────────────────────────────────────

/// The off-chain state of a payment channel.
///
/// Every field is owned to keep the struct `'static`-friendly and easy to
/// pass through async boundaries in the client crate.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelState {
    /// Unique channel identifier (string form of the on-chain `u64` ID).
    pub channel_id: String,
    /// Settlement contract address (Stellar `G…` public key or account ID).
    pub contract_address: String,
    /// Contract version string (e.g. `"1"`, `"2"`).  Included in the signed
    /// material so a state signed for V1 cannot be replayed against V2.
    pub contract_version: String,
    /// Strictly-increasing sequence number.  The contract rejects any state
    /// whose sequence is not higher than the last accepted one.
    pub nonce: u64,
    /// Payer-side balance in token units (non-negative).
    pub payer_balance: u128,
    /// Payee-side balance in token units (non-negative).
    pub payee_balance: u128,
    /// Inclusive start of the metering window (ms since Unix epoch).
    pub window_start: u64,
    /// Exclusive end of the metering window (ms since Unix epoch).
    pub window_end: u64,
}

// ── Encoding ──────────────────────────────────────────────────────────────────

/// Domain separator that prefixes every encoded state.
pub const DOMAIN_SEPARATOR: &str = "v3-channel-state";

/// Canonical, deterministic pipe-delimited encoding of a channel state.
///
/// The encoding is the payload that is hashed and/or signed.  It binds the
/// channel id, contract address, and contract version so a state signed for
/// one channel or contract cannot be replayed against another.
///
/// # Format
///
/// ```text
/// v3-channel-state|{contractVersion}|{contractAddress}|{channelId}|{nonce}|{payerBalance}|{payeeBalance}|{windowStart}|{windowEnd}
/// ```
///
/// # Cross-language compatibility
///
/// This format matches `encodeChannelState` in `packages/settlement/src/index.ts`
/// byte for byte.  The shared test vectors in
/// `tests/vectors/channel-state-vectors.json` are verified by both the
/// TypeScript suite and the Rust suite (`tests/vectors.rs` in this crate).
pub fn encode_channel_state(state: &ChannelState) -> String {
    // Pre-allocate a reasonable capacity to avoid repeated reallocations.
    let mut out = String::with_capacity(256);
    out.push_str(DOMAIN_SEPARATOR);
    out.push('|');
    out.push_str(&state.contract_version);
    out.push('|');
    out.push_str(&state.contract_address);
    out.push('|');
    out.push_str(&state.channel_id);
    out.push('|');
    out.push_str(&format!("{}", state.nonce));
    out.push('|');
    out.push_str(&format!("{}", state.payer_balance));
    out.push('|');
    out.push_str(&format!("{}", state.payee_balance));
    out.push('|');
    out.push_str(&format!("{}", state.window_start));
    out.push('|');
    out.push_str(&format!("{}", state.window_end));
    out
}

// ── Hashing & signing (feature-gated) ────────────────────────────────────────

#[cfg(feature = "signing")]
mod signing_impl {
    use super::*;
    use sha2::{Sha256, Digest as _};
    use hmac::{Hmac, Mac};

    type HmacSha256 = Hmac<Sha256>;

    /// SHA-256 digest of the canonical encoding, returned as 32 bytes.
    ///
    /// Use [`channel_state_digest_hex`] for the hex-encoded form.
    pub fn channel_state_digest(state: &ChannelState) -> [u8; 32] {
        let encoded = encode_channel_state(state);
        let mut hasher = Sha256::new();
        hasher.update(encoded.as_bytes());
        hasher.finalize().into()
    }

    /// SHA-256 digest of the canonical encoding, hex-encoded (64 lowercase hex chars).
    ///
    /// Matches `channelStateDigest` in `@syncro/settlement`.
    pub fn channel_state_digest_hex(state: &ChannelState) -> String {
        let bytes = channel_state_digest(state);
        hex_encode(&bytes)
    }

    /// Compute the HMAC-SHA-256 signature over the **encoded string** (not the
    /// hash) and return it hex-encoded.
    ///
    /// Matches `HmacChannelStateSigner.sign(encodeChannelState(state))` in
    /// `@syncro/settlement`.
    ///
    /// # Arguments
    ///
    /// * `state`  — The channel state to sign.
    /// * `key`    — Raw bytes of the HMAC key (UTF-8 string bytes from the TS
    ///              side, since `createHmac('sha256', key)` accepts strings).
    pub fn sign_channel_state(state: &ChannelState, key: &[u8]) -> String {
        let encoded = encode_channel_state(state);
        let mut mac = HmacSha256::new_from_slice(key)
            .expect("HMAC accepts any key length");
        mac.update(encoded.as_bytes());
        let result = mac.finalize().into_bytes();
        hex_encode(&result)
    }

    /// Constant-time verification of an HMAC-SHA-256 signature.
    ///
    /// Returns `true` if `expected_hex` matches the HMAC of the encoded state
    /// under `key`.
    pub fn verify_channel_state(state: &ChannelState, key: &[u8], expected_hex: &str) -> bool {
        let encoded = encode_channel_state(state);
        let Ok(expected_bytes) = hex_decode(expected_hex) else {
            return false;
        };
        let mut mac = HmacSha256::new_from_slice(key)
            .expect("HMAC accepts any key length");
        mac.update(encoded.as_bytes());
        mac.verify_slice(&expected_bytes).is_ok()
    }

    // ── Minimal hex helpers (no extra dep required) ──────────────────────────

    fn hex_encode(bytes: &[u8]) -> String {
        const HEX: &[u8] = b"0123456789abcdef";
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            s.push(HEX[(b >> 4) as usize] as char);
            s.push(HEX[(b & 0xf) as usize] as char);
        }
        s
    }

    fn hex_decode(s: &str) -> Result<Vec<u8>, ()> {
        if s.len() % 2 != 0 {
            return Err(());
        }
        let mut bytes = Vec::with_capacity(s.len() / 2);
        let chars: Vec<u8> = s.bytes().collect();
        for chunk in chars.chunks(2) {
            let hi = hex_nibble(chunk[0])?;
            let lo = hex_nibble(chunk[1])?;
            bytes.push((hi << 4) | lo);
        }
        Ok(bytes)
    }

    fn hex_nibble(c: u8) -> Result<u8, ()> {
        match c {
            b'0'..=b'9' => Ok(c - b'0'),
            b'a'..=b'f' => Ok(c - b'a' + 10),
            b'A'..=b'F' => Ok(c - b'A' + 10),
            _ => Err(()),
        }
    }
}

#[cfg(feature = "signing")]
pub use signing_impl::{
    channel_state_digest,
    channel_state_digest_hex,
    sign_channel_state,
    verify_channel_state,
};

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ChannelState {
        ChannelState {
            channel_id: "ch-zero-001".into(),
            contract_address: "GBV3TESTCONTRACTADDRESS123456789".into(),
            contract_version: "1".into(),
            nonce: 1,
            payer_balance: 0,
            payee_balance: 0,
            window_start: 1_700_000_000_000,
            window_end: 1_700_003_600_000,
        }
    }

    #[test]
    fn encoding_is_deterministic() {
        let s = sample();
        assert_eq!(encode_channel_state(&s), encode_channel_state(&s));
    }

    #[test]
    fn encoding_matches_expected_format() {
        let s = sample();
        let encoded = encode_channel_state(&s);
        assert_eq!(
            encoded,
            "v3-channel-state|1|GBV3TESTCONTRACTADDRESS123456789|ch-zero-001|1|0|0|1700000000000|1700003600000"
        );
    }

    #[cfg(feature = "signing")]
    #[test]
    fn digest_matches_known_vector() {
        // Computed offline via Node.js:
        // crypto.createHash('sha256').update(encode(state)).digest('hex')
        let s = sample();
        assert_eq!(
            channel_state_digest_hex(&s),
            "c8eab768579914d5f33b20bc5012342a62dcb6245c0f31add5d3ca36e0793a42"
        );
    }

    #[cfg(feature = "signing")]
    #[test]
    fn hmac_signature_matches_known_vector() {
        let s = sample();
        let key = b"test-secret-key-vector-1";
        assert_eq!(
            sign_channel_state(&s, key),
            "ae828e5aa8bf24b0500e1c4db00829a30133bac7b4072e568b3307e2b7aa05b9"
        );
    }

    #[cfg(feature = "signing")]
    #[test]
    fn verify_accepts_valid_signature() {
        let s = sample();
        let key = b"test-secret-key-vector-1";
        let sig = sign_channel_state(&s, key);
        assert!(verify_channel_state(&s, key, &sig));
    }

    #[cfg(feature = "signing")]
    #[test]
    fn verify_rejects_tampered_signature() {
        let s = sample();
        let key = b"test-secret-key-vector-1";
        assert!(!verify_channel_state(&s, key, "deadbeef"));
    }
}
