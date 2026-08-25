#![no_std]
//! Stealth Address Announcement Registry.
//!
//! # Purpose
//! Senders of stealth payments publish an **ephemeral pubkey** (R = r·G) alongside
//! an optional **view tag** on-chain.  Recipients scan announcements with their
//! view private key and, when the view tag matches, derive the one‑time stealth
//! address P = spend_pubkey + H(view_privkey · R)·G to detect incoming payments.
//!
//! # Privacy (No Linkability)
//! The contract deliberately stores **no sender identity, no recipient identity,
//! and no amount or asset**.  Every field is public by the very nature of the
//! stealth protocol:
//!
//! * `ephemeral_pubkey` – already committed in the payment transaction memo.
//! * `view_tag`           – the first byte of a hash anyone can *try* to match
//!                          against their own view key.  A single byte leaks
//!                          at most 1/256 of the search space and is purely a
//!                          scanning optimisation.
//! * `announcement_index` – a monotonic counter for pagination.
//! * `timestamp`          – ledger time, public regardless.
//!
//! An observer learns only that *someone* published a stealth announcement;
//! they cannot tell which recipient it is for, nor link two announcements to
//! the same recipient without knowledge of that recipient's view private key.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, Address, Bytes, Env,
    Vec,
};

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AnnouncementError {
    AlreadyInit       = 1,  // contract already initialised
    EmptyPubkey       = 2,  // ephemeral_pubkey has zero length
    PubkeyTooLong     = 3,  // ephemeral_pubkey exceeds 128 bytes
    RangeTooLarge     = 4,  // pagination range exceeds MAX_PAGE_SIZE
    InvalidRange      = 5,  // start > end
    NotAdmin          = 6,  // caller is not the admin
}

/// Maximum number of announcements returned in a single paginated query.
pub const MAX_PAGE_SIZE: u64 = 100;

/// Maximum acceptable byte length for an ephemeral pubkey.
/// secp256k1 compressed = 33 bytes; uncompressed = 65 bytes;
/// we accept up to 128 bytes to leave room for future schemes.
pub const MAX_PUBKEY_LEN: u32 = 128;

// ============================================================================
// Types
// ============================================================================

/// A single on‑chain stealth announcement.
///
/// Every field is public information; nothing links the announcement to a
/// specific recipient or sender.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StealthAnnouncement {
    /// Ephemeral public key R = r·G.  Variable‑length bytes so the registry
    /// is curve‑agnostic (secp256k1 compressed 33 B, ed25519 32 B, …).
    pub ephemeral_pubkey: Bytes,
    /// View tag — low 8 bits of H(ECDH(view_pubkey, R)), stored as u32
    /// because Soroban does not expose a raw u8 ABI.  Recipients reject
    /// ~255/256 non‑matching announcements without a full scalar mul.
    pub view_tag: u32,
    /// Monotonically increasing index assigned at publish time.  Used as the
    /// pagination cursor — guarantees order without leaking timing correlation
    /// beyond the public ledger timestamp.
    pub announcement_index: u64,
    /// Ledger timestamp when the announcement was recorded.
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    AnnouncementCount,
    Announcement(u64),
}

// ============================================================================
// Events
// ============================================================================

/// Fired when a new announcement is published.  The index is the only new
/// piece of data (the rest are also in calldata) — included for event log
/// consumers that want a short lookup key.
#[contractevent]
pub struct AnnouncementPublished {
    pub announcement_index: u64,
    pub view_tag: u32,
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct StealthAnnouncementContract;

#[contractimpl]
impl StealthAnnouncementContract {
    // ------------------------------------------------------------------------
    // Initialisation
    // ------------------------------------------------------------------------

    /// Initialise the registry with an optional `admin` address.
    ///
    /// The admin has no special powers over announcements (anyone can publish,
    /// anyone can query) — the role exists purely to allow future upgrades of
    /// the contract if the workspace adopts the `contract-upgrade` pattern.
    /// Pass the zero/any address if you want an effectively immutable registry.
    pub fn init(env: Env, admin: Address) -> Result<(), AnnouncementError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(AnnouncementError::AlreadyInit);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AnnouncementCount, &0u64);
        Ok(())
    }

    /// Return the admin address, if any.  Exposed for upgrade tooling.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    // ------------------------------------------------------------------------
    // Publish
    // ------------------------------------------------------------------------

    /// Publish a stealth announcement.
    ///
    /// # Arguments
    /// * `ephemeral_pubkey` – ephemeral public key R.  Variable length; the
    ///   contract does *not* validate the point (validation is the scanner's
    ///   responsibility and skipping it keeps the registry lightweight and
    ///   curve‑agnostic).  However we do reject empty bytes and cap length at
    ///   `MAX_PUBKEY_LEN` to prevent griefing.
    /// * `view_tag` – first byte of `H(shared_secret)`.  The contract does
    ///   **not** verify it (the sender could even lie); recipients do the
    ///   check off‑chain and simply skip false positives.
    ///
    /// # Returns
    /// The `announcement_index` assigned to this entry.
    ///
    /// # Permissions
    /// **Any** address may call `publish`.  Announcements are inherently
    /// self‑authenticating via the ECDH that recipients run; spamming costs
    /// the sender transaction fees and recipients' view‑tag filter discards
    /// junk at ~1/256 false‑positive rate.
    pub fn publish(
        env: Env,
        ephemeral_pubkey: Bytes,
        view_tag: u32,
    ) -> Result<u64, AnnouncementError> {
        if ephemeral_pubkey.is_empty() {
            return Err(AnnouncementError::EmptyPubkey);
        }
        if ephemeral_pubkey.len() > MAX_PUBKEY_LEN {
            return Err(AnnouncementError::PubkeyTooLong);
        }
        // Mask to the low 8 bits so the stored value is always 0..=255
        // regardless of what the caller passes.  Scanners only inspect one
        // byte; keeping the range small makes the on‑chain data uniform and
        // avoids accidentally leaking a 32‑bit correlate.
        let view_tag_clamped = view_tag & 0xFF;

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AnnouncementCount)
            .unwrap_or(0);

        let index = count
            .checked_add(1)
            .expect("announcement index overflow");

        env.storage()
            .instance()
            .set(&DataKey::AnnouncementCount, &index);

        let announcement = StealthAnnouncement {
            ephemeral_pubkey: ephemeral_pubkey.clone(),
            view_tag: view_tag_clamped,
            announcement_index: count,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Announcement(count), &announcement);

        AnnouncementPublished {
            announcement_index: count,
            view_tag: view_tag_clamped,
        }
        .publish(&env);

        Ok(count)
    }

    // ------------------------------------------------------------------------
    // Query (single)
    // ------------------------------------------------------------------------

    /// Fetch a single announcement by its monotonic `announcement_index`.
    pub fn get_announcement(env: Env, announcement_index: u64) -> Option<StealthAnnouncement> {
        env.storage()
            .persistent()
            .get(&DataKey::Announcement(announcement_index))
    }

    /// Total number of announcements ever published.
    pub fn get_announcement_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::AnnouncementCount)
            .unwrap_or(0)
    }

    // ------------------------------------------------------------------------
    // Query (paginated range)
    // ------------------------------------------------------------------------

    /// Fetch announcements by inclusive index range: `[start_index, end_index]`.
    ///
    /// # Pagination cursors
    /// The caller uses `announcement_index` as a cursor.  For example:
    /// * first page: `start = 0, end = min(99, count - 1)`
    /// * next page:  `start = prev_end + 1, end = min(start + 99, count - 1)`
    ///
    /// # Limits
    /// At most `MAX_PAGE_SIZE` entries are returned per call.  Use multiple
    /// calls to walk the full set — the monotonic index guarantees you won't
    /// miss or double‑count entries as new announcements are appended.
    ///
    /// Gaps (e.g. if an individual entry were somehow missing) are skipped
    /// silently — this matches the behaviour of the `subscription_logging`
    /// contract and keeps iteration simple.
    pub fn get_announcements_range(
        env: Env,
        start_index: u64,
        end_index: u64,
    ) -> Result<Vec<StealthAnnouncement>, AnnouncementError> {
        if end_index < start_index {
            return Err(AnnouncementError::InvalidRange);
        }
        let range_size = end_index - start_index + 1;
        if range_size > MAX_PAGE_SIZE {
            return Err(AnnouncementError::RangeTooLarge);
        }

        let mut results = vec![&env];
        for idx in start_index..=end_index {
            if let Some(a) = Self::get_announcement(env.clone(), idx) {
                results.push_back(a);
            }
        }
        Ok(results)
    }

    /// Convenience: return the last `limit` announcements (most recent first).
    ///
    /// Equivalent to calling `get_announcement_count()` then building a
    /// range `[count - limit, count - 1]`.  Useful for UI "latest" widgets.
    ///
    /// `limit` is capped at `MAX_PAGE_SIZE`.
    pub fn get_latest_announcements(
        env: Env,
        limit: u64,
    ) -> Result<Vec<StealthAnnouncement>, AnnouncementError> {
        let count = Self::get_announcement_count(env.clone());
        if count == 0 {
            return Ok(vec![&env]);
        }
        let effective_limit = if limit > MAX_PAGE_SIZE {
            MAX_PAGE_SIZE
        } else {
            limit
        };
        let start = count.saturating_sub(effective_limit);
        let end = count - 1;

        let page = Self::get_announcements_range(env.clone(), start, end)?;
        // Reverse so newest is first.
        let mut reversed = vec![&env];
        for i in (0..page.len()).rev() {
            reversed.push_back(page.get_unchecked(i).clone());
        }
        Ok(reversed)
    }

    // ------------------------------------------------------------------------
    // Admin-only helpers (none of them can censor announcements)
    // ------------------------------------------------------------------------

    fn require_admin(env: &Env) -> Result<(), AnnouncementError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AnnouncementError::NotAdmin)?;
        admin.require_auth();
        Ok(())
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod negative;

