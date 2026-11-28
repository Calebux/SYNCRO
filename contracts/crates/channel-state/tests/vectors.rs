//! Cross-language test vectors for channel-state encoding.
//!
//! Loads `tests/vectors/channel-state-vectors.json` from the repo root and
//! verifies that the Rust `encode_channel_state`, `channel_state_digest_hex`,
//! and `sign_channel_state` produce exactly the same bytes as the TypeScript
//! implementations in `packages/settlement`.
//!
//! This is the Rust side of the acceptance criterion:
//! > "Rust output matches the TypeScript output byte for byte on the shared vectors."
//!
//! The TypeScript side is in `tests/vectors/channel-state-vectors.test.ts`.

use std::fs;
use std::path::Path;
use serde::Deserialize;
use syncro_channel_state::{ChannelState, encode_channel_state, channel_state_digest_hex, sign_channel_state};

#[derive(Deserialize)]
struct VectorState {
    #[serde(rename = "channelId")]
    channel_id: String,
    #[serde(rename = "contractAddress")]
    contract_address: String,
    #[serde(rename = "contractVersion")]
    contract_version: u64,
    nonce: u64,
    #[serde(rename = "payerBalance")]
    payer_balance: String,
    #[serde(rename = "payeeBalance")]
    payee_balance: String,
    #[serde(rename = "windowStart")]
    window_start: u64,
    #[serde(rename = "windowEnd")]
    window_end: u64,
}

#[derive(Deserialize)]
struct TestVector {
    name: String,
    state: VectorState,
    #[serde(rename = "signingKey")]
    signing_key: String,
    #[serde(rename = "expectedDigest")]
    expected_digest: String,
    #[serde(rename = "expectedSignature")]
    expected_signature: String,
    #[serde(rename = "expectedEncoding")]
    expected_encoding: String,
}

#[derive(Deserialize)]
struct VectorFile {
    vectors: Vec<TestVector>,
}

fn load_vectors() -> VectorFile {
    // The integration test runs with the workspace root as the working
    // directory when invoked via `cargo test --manifest-path contracts/...`.
    let candidates = [
        "../../tests/vectors/channel-state-vectors.json",
        "../../../tests/vectors/channel-state-vectors.json",
        "tests/vectors/channel-state-vectors.json",
    ];
    for path in &candidates {
        if Path::new(path).exists() {
            let raw = fs::read_to_string(path)
                .unwrap_or_else(|e| panic!("failed to read {path}: {e}"));
            return serde_json::from_str(&raw)
                .unwrap_or_else(|e| panic!("failed to parse {path}: {e}"));
        }
    }
    panic!("could not locate channel-state-vectors.json — tried: {candidates:?}");
}

fn make_state(v: &VectorState) -> ChannelState {
    ChannelState {
        channel_id:       v.channel_id.clone(),
        contract_address: v.contract_address.clone(),
        contract_version: v.contract_version.to_string(),
        nonce:            v.nonce,
        payer_balance:    v.payer_balance.parse::<u128>()
                            .unwrap_or_else(|_| panic!("invalid payer_balance: {}", v.payer_balance)),
        payee_balance:    v.payee_balance.parse::<u128>()
                            .unwrap_or_else(|_| panic!("invalid payee_balance: {}", v.payee_balance)),
        window_start:     v.window_start,
        window_end:       v.window_end,
    }
}

#[test]
fn cross_language_vectors_pass() {
    let vf = load_vectors();
    let mut passed = 0usize;

    for vector in &vf.vectors {
        let state = make_state(&vector.state);

        // 1. Encoding is byte-for-byte identical to the TypeScript side.
        let rust_encoding = encode_channel_state(&state);
        assert_eq!(
            rust_encoding, vector.expected_encoding,
            "vector '{}': encoding mismatch\n  Rust: {}\n  TS:   {}",
            vector.name, rust_encoding, vector.expected_encoding
        );

        // 2. SHA-256 digest matches.
        let rust_digest = channel_state_digest_hex(&state);
        assert_eq!(
            rust_digest, vector.expected_digest,
            "vector '{}': digest mismatch\n  Rust: {}\n  TS:   {}",
            vector.name, rust_digest, vector.expected_digest
        );

        // 3. HMAC-SHA-256 signature matches.
        let rust_sig = sign_channel_state(&state, vector.signing_key.as_bytes());
        assert_eq!(
            rust_sig, vector.expected_signature,
            "vector '{}': signature mismatch\n  Rust: {}\n  TS:   {}",
            vector.name, rust_sig, vector.expected_signature
        );

        passed += 1;
    }

    assert!(passed > 0, "no vectors were loaded — check the JSON file path");
    println!("cross_language_vectors_pass: {passed} vectors OK");
}

#[test]
fn encoding_is_deterministic() {
    let vf = load_vectors();
    for vector in &vf.vectors {
        let state = make_state(&vector.state);
        assert_eq!(
            encode_channel_state(&state),
            encode_channel_state(&state),
            "vector '{}': encoding is not deterministic",
            vector.name
        );
    }
}
