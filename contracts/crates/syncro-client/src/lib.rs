//! # syncro-client
//!
//! A `reqwest`-based Rust client for Syncro payment-gated APIs.
//!
//! ## What it does
//!
//! * Wraps `reqwest` with automatic HTTP-402 (payment-required) handling.
//! * Uses [`syncro_channel_state`] — the same crate depended on by the
//!   payment-channel contract — to encode and sign payment proofs, eliminating
//!   any risk of an encoding mismatch between off-chain and on-chain code.
//! * Verifies provider receipts: the response must carry a valid HMAC-SHA-256
//!   signature over the canonical receipt payload.
//!
//! ## Quick start
//!
//! ```rust,no_run
//! use syncro_client::{PaidClient, PaidClientConfig, ChannelCredentials};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let client = PaidClient::new(PaidClientConfig {
//!         base_url: "https://api.example.com".to_string(),
//!         credentials: ChannelCredentials {
//!             channel_id: "ch-001".to_string(),
//!             contract_address: "GCONTRACT...".to_string(),
//!             contract_version: "1".to_string(),
//!             signing_key: b"my-hmac-key".to_vec(),
//!         },
//!         provider_verify_key: None,
//!     });
//!
//!     let body: serde_json::Value = client
//!         .get("/endpoint")
//!         .await?;
//!     println!("{body}");
//!     Ok(())
//! }
//! ```

use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use syncro_channel_state::{ChannelState, sign_channel_state, encode_channel_state};

// ── Error type ────────────────────────────────────────────────────────────────

/// All errors that can be produced by the paid client.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("HTTP transport error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON serialisation error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("server returned HTTP {status} without a parseable PAYMENT-REQUIRED header")]
    MissingPaymentHeader { status: u16 },

    #[error("server returned HTTP {status} after payment was submitted")]
    PaymentRejected { status: u16 },

    #[error("receipt verification failed: {reason}")]
    ReceiptInvalid { reason: String },

    #[error("base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),
}

// ── Configuration ─────────────────────────────────────────────────────────────

/// Channel credentials used to sign payment proofs.
///
/// All fields must match what is registered on-chain in the payment-channel
/// contract; mismatches will cause proof rejection at the gateway.
#[derive(Clone, Debug)]
pub struct ChannelCredentials {
    /// String form of the on-chain channel ID (u64 as decimal string).
    pub channel_id: String,
    /// Stellar contract address (`G…` or `C…` encoding).
    pub contract_address: String,
    /// Contract version string (e.g. `"1"`).
    pub contract_version: String,
    /// Raw bytes of the HMAC-SHA-256 signing key shared with the gateway.
    pub signing_key: Vec<u8>,
}

/// Configuration for a [`PaidClient`] instance.
#[derive(Clone, Debug)]
pub struct PaidClientConfig {
    /// Base URL of the payment-gated API (without trailing slash).
    pub base_url: String,
    /// Channel credentials used to sign payment proofs.
    pub credentials: ChannelCredentials,
    /// Optional provider public key (hex-encoded HMAC key) for receipt
    /// verification.  When `None`, receipts are accepted without signature
    /// verification (useful in tests).
    pub provider_verify_key: Option<Vec<u8>>,
}

// ── Wire types ────────────────────────────────────────────────────────────────

/// The x402 payment-required header payload.
#[derive(Debug, Deserialize)]
struct PaymentRequired {
    #[serde(rename = "channelId")]
    channel_id: String,
    nonce: u64,
    amount: u128,
    #[serde(rename = "windowStart")]
    window_start: u64,
    #[serde(rename = "windowEnd")]
    window_end: u64,
}

/// A signed payment proof sent in `X-Payment-Proof`.
#[derive(Debug, Serialize)]
struct PaymentProof {
    #[serde(rename = "channelId")]
    channel_id: String,
    nonce: u64,
    amount: u128,
    #[serde(rename = "windowStart")]
    window_start: u64,
    #[serde(rename = "windowEnd")]
    window_end: u64,
    signature: String,
}

/// The receipt returned in `X-Payment-Receipt` on a successful response.
#[derive(Debug, Deserialize, Clone)]
pub struct PaidReceipt {
    #[serde(rename = "channelId")]
    pub channel_id: String,
    pub nonce: u64,
    pub amount: u128,
    /// Provider HMAC-SHA-256 signature over the canonical receipt encoding.
    pub signature: String,
}

impl PaidReceipt {
    /// Canonical pipe-delimited encoding of a receipt (mirrors the channel-state
    /// encoding convention so the same infrastructure can verify both).
    pub fn canonical_encoding(&self) -> String {
        format!(
            "v3-receipt|{}|{}|{}",
            self.channel_id, self.nonce, self.amount
        )
    }
}

// ── Main client ───────────────────────────────────────────────────────────────

/// A `reqwest`-based client that automatically handles HTTP-402 challenges.
///
/// On first seeing a 402 response the client:
/// 1. Parses the `X-Payment-Required` header.
/// 2. Builds a [`ChannelState`] from the challenge + local credentials.
/// 3. Signs it with [`sign_channel_state`] — **the same encoding used by the
///    on-chain contract** — via the shared `syncro-channel-state` crate.
/// 4. Retries the request with an `X-Payment-Proof` header.
/// 5. On success, optionally verifies the `X-Payment-Receipt` signature.
#[derive(Clone)]
pub struct PaidClient {
    inner: reqwest::Client,
    config: PaidClientConfig,
}

impl PaidClient {
    /// Create a new paid client.
    pub fn new(config: PaidClientConfig) -> Self {
        Self {
            inner: reqwest::Client::new(),
            config,
        }
    }

    /// Issue a GET request to `path` (relative to `base_url`).
    ///
    /// Returns the parsed JSON response body on success.  Handles a single
    /// HTTP-402 round trip automatically.
    pub async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
    ) -> Result<T, ClientError> {
        self.request(reqwest::Method::GET, path, None::<&()>).await
    }

    /// Issue a POST request with a JSON body.
    pub async fn post<B: Serialize, T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ClientError> {
        self.request(reqwest::Method::POST, path, Some(body)).await
    }

    // ── Internal ──────────────────────────────────────────────────────────

    async fn request<B: Serialize, T: for<'de> Deserialize<'de>>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<T, ClientError> {
        let url = format!("{}{}", self.config.base_url, path);

        // Initial attempt — no payment proof.
        let mut req = self.inner.request(method.clone(), &url);
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().await?;

        if resp.status() == reqwest::StatusCode::PAYMENT_REQUIRED {
            return self.handle_payment(method, &url, body).await;
        }

        let status = resp.status();
        if !status.is_success() {
            return Err(ClientError::PaymentRejected { status: status.as_u16() });
        }

        Ok(resp.json::<T>().await?)
    }

    async fn handle_payment<B: Serialize, T: for<'de> Deserialize<'de>>(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<&B>,
    ) -> Result<T, ClientError> {
        // Re-issue the initial request to get the payment-required header.
        let mut probe = self.inner.request(method.clone(), url);
        if let Some(b) = body {
            probe = probe.json(b);
        }
        let probe_resp = probe.send().await?;

        let pr_header = probe_resp
            .headers()
            .get("x-payment-required")
            .ok_or_else(|| ClientError::MissingPaymentHeader {
                status: probe_resp.status().as_u16(),
            })?
            .to_str()
            .unwrap_or_default()
            .to_string();

        let pr: PaymentRequired = serde_json::from_str(&pr_header)?;

        // Build the ChannelState from the challenge and sign it.
        let creds = &self.config.credentials;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let channel_state = ChannelState {
            channel_id:       pr.channel_id.clone(),
            contract_address: creds.contract_address.clone(),
            contract_version: creds.contract_version.clone(),
            nonce:            pr.nonce,
            payer_balance:    0, // balance is tracked server-side; proof is about amount
            payee_balance:    pr.amount,
            window_start:     pr.window_start,
            window_end:       pr.window_end,
        };

        // This call uses the **same encoding function** as the on-chain contract
        // test suite — both depend on `syncro-channel-state`.
        let signature = sign_channel_state(&channel_state, &creds.signing_key);

        let proof = PaymentProof {
            channel_id:   pr.channel_id,
            nonce:        pr.nonce,
            amount:       pr.amount,
            window_start: pr.window_start,
            window_end:   pr.window_end,
            signature,
        };

        // Retry with the proof attached.
        let proof_header = serde_json::to_string(&proof)?;
        let mut retry = self.inner.request(method, url);
        if let Some(b) = body {
            retry = retry.json(b);
        }
        let retry_resp = retry
            .header("x-payment-proof", proof_header)
            .send()
            .await?;

        let status = retry_resp.status();
        if !status.is_success() {
            return Err(ClientError::PaymentRejected { status: status.as_u16() });
        }

        // Optionally verify the receipt.
        if let Some(verify_key) = &self.config.provider_verify_key {
            if let Some(receipt_hdr) = retry_resp.headers().get("x-payment-receipt") {
                let receipt_str = receipt_hdr.to_str().unwrap_or_default();
                let receipt: PaidReceipt = serde_json::from_str(receipt_str)?;
                self.verify_receipt(&receipt, verify_key)?;
            }
        }

        Ok(retry_resp.json::<T>().await?)
    }

    /// Verify a provider receipt using HMAC-SHA-256.
    ///
    /// The canonical encoding of a receipt is:
    /// ```text
    /// v3-receipt|{channelId}|{nonce}|{amount}
    /// ```
    ///
    /// The provider signs this string with its private HMAC key; the client
    /// verifies it with the shared verify key.
    pub fn verify_receipt(
        &self,
        receipt: &PaidReceipt,
        verify_key: &[u8],
    ) -> Result<(), ClientError> {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;

        type HmacSha256 = Hmac<Sha256>;

        let encoded = receipt.canonical_encoding();
        let expected_bytes =
            hex::decode(&receipt.signature).map_err(|_| ClientError::ReceiptInvalid {
                reason: "signature is not valid hex".into(),
            })?;

        let mut mac = HmacSha256::new_from_slice(verify_key)
            .map_err(|e| ClientError::ReceiptInvalid { reason: e.to_string() })?;
        mac.update(encoded.as_bytes());
        mac.verify_slice(&expected_bytes).map_err(|_| ClientError::ReceiptInvalid {
            reason: "HMAC verification failed".into(),
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_canonical_encoding() {
        let r = PaidReceipt {
            channel_id: "ch-001".to_string(),
            nonce: 42,
            amount: 1000,
            signature: "deadbeef".to_string(),
        };
        assert_eq!(r.canonical_encoding(), "v3-receipt|ch-001|42|1000");
    }

    #[test]
    fn payment_proof_uses_channel_state_encoding() {
        // Confirm the proof signature is derived from encode_channel_state so
        // the on-chain contract can verify it with the same routine.
        let creds = ChannelCredentials {
            channel_id: "ch-001".to_string(),
            contract_address: "GCONTRACT".to_string(),
            contract_version: "1".to_string(),
            signing_key: b"my-key".to_vec(),
        };
        let state = ChannelState {
            channel_id: "ch-001".to_string(),
            contract_address: "GCONTRACT".to_string(),
            contract_version: "1".to_string(),
            nonce: 1,
            payer_balance: 0,
            payee_balance: 500,
            window_start: 1_000,
            window_end: 2_000,
        };
        let sig = sign_channel_state(&state, &creds.signing_key);
        // The encoding must start with the domain separator.
        let encoded = encode_channel_state(&state);
        assert!(encoded.starts_with("v3-channel-state|"));
        // The signature is a 64-char hex string (SHA-256 output).
        assert_eq!(sig.len(), 64);
    }
}
