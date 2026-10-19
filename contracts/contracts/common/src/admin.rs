#![no_std]

//! Two-step admin transfer shared by all Syncro contracts (issue #1659).
//!
//! The flow mirrors `agent-registry`: the current admin nominates a successor
//! with `transfer_admin`, which does NOT change the admin; the nominee
//! completes the handover with `accept_admin`, and the current admin may abort
//! with `cancel_transfer_admin`. Requiring the nominee's own auth prevents an
//! irrecoverable transfer to a wrong or typo'd address.
//!
//! Each contract keeps its own `Admin` / `PendingAdmin` storage keys and error
//! type; this module owns the shared pieces: the pure transition checks (also
//! unit-tested here) and the canonical event topics so every contract emits
//! identical `admin/xfer_init`, `admin/xfer_cxl`, and `admin/xfer_ok` events.

use soroban_sdk::{Address, Symbol, symbol_short};

/// Topic of the event published when a transfer is initiated.
pub fn topic_init() -> (Symbol, Symbol) {
    (symbol_short!("admin"), symbol_short!("xfer_init"))
}

/// Topic of the event published when a transfer is cancelled.
pub fn topic_cancel() -> (Symbol, Symbol) {
    (symbol_short!("admin"), symbol_short!("xfer_cxl"))
}

/// Topic of the event published when a transfer is accepted.
pub fn topic_accept() -> (Symbol, Symbol) {
    (symbol_short!("admin"), symbol_short!("xfer_ok"))
}

/// True when `caller` is the current `admin` and may start or cancel a transfer.
pub fn is_admin(caller: &Address, admin: &Address) -> bool {
    caller == admin
}

/// True when `caller` is the nominated `pending` admin and may accept.
///
/// `None` (no transfer in progress) never accepts, and any address other than
/// the nominee is rejected — this is the check that stops a wrong address
/// from completing someone else's handover.
pub fn can_accept(caller: &Address, pending: &Option<Address>) -> bool {
    match pending {
        Some(nominee) => caller == nominee,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_admin_may_start_or_cancel() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let other = Address::generate(&env);
        assert!(is_admin(&admin, &admin));
        assert!(!is_admin(&other, &admin));
    }

    #[test]
    fn only_nominee_may_accept() {
        let env = Env::default();
        let nominee = Address::generate(&env);
        let stranger = Address::generate(&env);
        assert!(can_accept(&nominee, &Some(nominee.clone())));
        assert!(!can_accept(&stranger, &Some(nominee)));
        assert!(!can_accept(&stranger, &None));
    }

    #[test]
    fn topics_are_stable() {
        assert_eq!(topic_init().1, symbol_short!("xfer_init"));
        assert_eq!(topic_cancel().1, symbol_short!("xfer_cxl"));
        assert_eq!(topic_accept().1, symbol_short!("xfer_ok"));
    }
}

// `Env` is only referenced by the tests; keep the import test-gated so the
// `no_std` library build stays warning-free.
#[cfg(test)]
use soroban_sdk::Env;
