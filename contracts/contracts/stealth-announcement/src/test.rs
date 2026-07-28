#[cfg(test)]
mod tests {
    use crate::{AnnouncementError, StealthAnnouncement, StealthAnnouncementContract, MAX_PAGE_SIZE};
    use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
    use soroban_sdk::{Address, Bytes, Env};
    use std::panic::catch_unwind;

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StealthAnnouncementContract, ());
        let admin = Address::generate(&env);
        // init() auto-unwraps in the generated client.
        env.invoke_contract::<()>(
            &contract_id,
            &soroban_sdk::Symbol::new(&env, "init"),
            (admin.clone(),).into_val(&env),
        );
        (env, contract_id, admin)
    }

    /// Build the typed client on demand.  Using the client directly
    /// auto-unwraps Results (panics on error).
    fn client<'a>(
        env: &'a Env,
        id: &'a Address,
    ) -> StealthAnnouncementContractClient<'a> {
        StealthAnnouncementContractClient::new(env, id)
    }

    fn fake_pubkey(env: &Env, seed: u8, len: usize) -> Bytes {
        let mut b = Bytes::new(env);
        for i in 0..len {
            b.push_back(seed.wrapping_add(i as u8));
        }
        b
    }

    fn secp256k1_compressed_pubkey(env: &Env, seed: u8) -> Bytes {
        fake_pubkey(env, seed, 33)
    }

    /// Assert that a closure panics, returning the panic payload.
    fn assert_panics<F: FnOnce() + std::panic::UnwindSafe>(f: F) {
        let result = catch_unwind(f);
        assert!(result.is_err(), "expected the call to panic but it succeeded");
    }

    // ------------------------------------------------------------------------
    // Initialisation
    // ------------------------------------------------------------------------

    #[test]
    fn test_init_ok_and_get_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(StealthAnnouncementContract, ());
        let client_obj = StealthAnnouncementContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client_obj.init(&admin); // client auto-unwraps Result
        assert_eq!(client_obj.get_admin(), Some(admin));
    }

    #[test]
    fn test_double_init_panics() {
        let (env, id, _) = setup();
        let client_obj = client(&env, &id);
        let another = Address::generate(&env);
        assert_panics(move || client_obj.init(&another));
    }

    // ------------------------------------------------------------------------
    // Publish: happy paths
    // ------------------------------------------------------------------------

    #[test]
    fn test_publish_single_returns_index_zero() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let pk = secp256k1_compressed_pubkey(&env, 0xAA);
        let idx = c.publish(&pk, &0x42u32);
        assert_eq!(idx, 0);
        assert_eq!(c.get_announcement_count(), 1);
    }

    #[test]
    fn test_publish_indices_are_monotonic() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        for i in 0..5u8 {
            let pk = secp256k1_compressed_pubkey(&env, i);
            let idx = c.publish(&pk, &(i as u32));
            assert_eq!(idx, i as u64);
        }
        assert_eq!(c.get_announcement_count(), 5);
    }

    #[test]
    fn test_publish_preserves_view_tag_and_pubkey() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let pk = secp256k1_compressed_pubkey(&env, 0x11);
        let tag: u32 = 0x7F;
        let idx = c.publish(&pk, &tag);

        let a = c.get_announcement(&idx).unwrap();
        assert_eq!(a.ephemeral_pubkey, pk);
        assert_eq!(a.view_tag, tag);
        assert_eq!(a.announcement_index, idx);
    }

    #[test]
    fn test_publish_view_tag_high_bits_masked() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let pk = secp256k1_compressed_pubkey(&env, 0x01);
        let idx = c.publish(&pk, &0xDEAD_BEEFu32);
        let a = c.get_announcement(&idx).unwrap();
        assert_eq!(a.view_tag, 0xEF);
    }

    #[test]
    fn test_publish_records_timestamp() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

        let pk = secp256k1_compressed_pubkey(&env, 1);
        let idx = c.publish(&pk, &0u32);
        assert_eq!(c.get_announcement(&idx).unwrap().timestamp, 1_700_000_000);

        env.ledger().with_mut(|li| li.timestamp = 1_700_000_001);
        let pk2 = secp256k1_compressed_pubkey(&env, 2);
        let idx2 = c.publish(&pk2, &0u32);
        assert_eq!(c.get_announcement(&idx2).unwrap().timestamp, 1_700_000_001);
    }

    // ------------------------------------------------------------------------
    // Publish: permissionless
    // ------------------------------------------------------------------------

    #[test]
    fn test_publish_requires_no_sender_auth() {
        // Setup only mocks auths for init; we then drop that scope.
        let env = Env::default();
        let contract_id = env.register(StealthAnnouncementContract, ());

        // For init we do need to allow the storage-write side effects.
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let client_init = StealthAnnouncementContractClient::new(&env, &contract_id);
        client_init.init(&admin);
        drop(client_init);

        // Now call publish WITHOUT any mock_all_auths — if the contract tried
        // to require_auth() for any sender address, the call would panic.
        let env2 = Env::clone(&env);
        let c = StealthAnnouncementContractClient::new(&env2, &contract_id);
        let pk = secp256k1_compressed_pubkey(&env2, 9);
        let idx = c.publish(&pk, &5u32);
        assert_eq!(idx, 0);
    }

    // ------------------------------------------------------------------------
    // Publish: input validation (panics on invalid input)
    // ------------------------------------------------------------------------

    #[test]
    fn test_publish_empty_pubkey_panics() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let empty = Bytes::new(&env);
        assert_panics(move || c.publish(&empty, &0u32));
        assert_eq!(c.get_announcement_count(), 0);
    }

    #[test]
    fn test_publish_pubkey_too_long_panics() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let too_big = fake_pubkey(&env, 1, 129);
        assert_panics(move || c.publish(&too_big, &0u32));
        assert_eq!(c.get_announcement_count(), 0);
    }

    #[test]
    fn test_publish_accepts_boundary_lengths() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let one_byte = fake_pubkey(&env, 1, 1);
        let max_len = fake_pubkey(&env, 2, 128);
        let idx0 = c.publish(&one_byte, &0u32);
        let idx1 = c.publish(&max_len, &1u32);
        assert_eq!(idx0, 0);
        assert_eq!(idx1, 1);
        assert_eq!(c.get_announcement_count(), 2);
    }

    // ------------------------------------------------------------------------
    // Query: single
    // ------------------------------------------------------------------------

    #[test]
    fn test_get_missing_returns_none() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        assert_eq!(c.get_announcement(&0), None);
        assert_eq!(c.get_announcement(&9999), None);
    }

    // ------------------------------------------------------------------------
    // Query: range pagination
    // ------------------------------------------------------------------------

    fn publish_n(env: &Env, id: &Address, n: u8) {
        let c = client(env, id);
        for i in 0..n {
            let pk = secp256k1_compressed_pubkey(env, i);
            c.publish(&pk, &(i as u32));
        }
    }

    #[test]
    fn test_range_empty_when_nothing_published() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let r = c.get_announcements_range(&0, &0);
        assert_eq!(r.len(), 0);
    }

    #[test]
    fn test_range_returns_exact_count() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 10);
        let c = client(&env, &id);
        let r = c.get_announcements_range(&2, &7);
        assert_eq!(r.len(), 6);
        for i in 0..r.len() {
            assert_eq!(
                r.get_unchecked(i).announcement_index,
                (2 + i as u64)
            );
        }
    }

    #[test]
    fn test_range_start_equals_end() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 3);
        let c = client(&env, &id);
        let r = c.get_announcements_range(&1, &1);
        assert_eq!(r.len(), 1);
        assert_eq!(r.first().unwrap().announcement_index, 1);
    }

    #[test]
    fn test_range_skips_missing_indices_gracefully() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 5);
        let c = client(&env, &id);
        let r = c.get_announcements_range(&0, &10);
        assert_eq!(r.len(), 5);
        for i in 0..r.len() {
            assert_eq!(r.get_unchecked(i).announcement_index, i as u64);
        }
    }

    #[test]
    fn test_range_inverted_panics() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 5);
        let c = client(&env, &id);
        assert_panics(move || c.get_announcements_range(&5, &2));
    }

    #[test]
    fn test_range_above_max_size_panics() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 101);
        let c = client(&env, &id);
        assert_panics(move || c.get_announcements_range(&0, &100));
    }

    #[test]
    fn test_range_max_size_allowed() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 100);
        let c = client(&env, &id);
        let r = c.get_announcements_range(&0, &99);
        assert_eq!(r.len(), 100);
    }

    #[test]
    fn test_pagination_full_walk() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 253);
        let c = client(&env, &id);

        let mut seen = 0u64;
        let mut cursor: u64 = 0;
        let count = c.get_announcement_count();

        while cursor < count {
            let end = core::cmp::min(cursor + 99, count - 1);
            let page = c.get_announcements_range(&cursor, &end);
            assert!(page.len() > 0);
            seen += page.len() as u64;
            cursor = end + 1;
        }

        assert_eq!(seen, count);
        assert_eq!(seen, 253);
    }

    // ------------------------------------------------------------------------
    // Query: latest (reverse) convenience
    // ------------------------------------------------------------------------

    #[test]
    fn test_latest_empty() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let r = c.get_latest_announcements(&5);
        assert_eq!(r.len(), 0);
    }

    #[test]
    fn test_latest_returns_reversed_order() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 5);
        let c = client(&env, &id);
        let r = c.get_latest_announcements(&3);
        assert_eq!(r.len(), 3);
        assert_eq!(r.get_unchecked(0).announcement_index, 4);
        assert_eq!(r.get_unchecked(1).announcement_index, 3);
        assert_eq!(r.get_unchecked(2).announcement_index, 2);
        assert_eq!(r.get_unchecked(0).view_tag, 4);
        assert_eq!(r.get_unchecked(2).view_tag, 2);
    }

    #[test]
    fn test_latest_limit_capped_at_max_page_size() {
        let (env, id, _) = setup();
        publish_n(&env, &id, 150);
        let c = client(&env, &id);
        let r = c.get_latest_announcements(&200);
        assert_eq!(r.len() as u64, MAX_PAGE_SIZE as u64);
    }

    // ------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------

    #[test]
    fn test_publish_emits_event() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let pk = secp256k1_compressed_pubkey(&env, 7);
        let tag: u32 = 0x33;
        let before = env.events().all().into_iter().count();
        c.publish(&pk, &tag);
        let after = env.events().all().into_iter().count();
        assert!(after > before, "expected new events after publish");
    }

    // ------------------------------------------------------------------------
    // No-linkability (structural + behavioural)
    // ------------------------------------------------------------------------

    #[test]
    fn test_stored_record_contains_no_identity_fields() {
        let (env, id, _) = setup();
        let c = client(&env, &id);

        for i in 0..8u8 {
            let pk = secp256k1_compressed_pubkey(&env, i);
            c.publish(&pk, &(i as u32));
        }

        let all = c.get_announcements_range(&0, &7);
        for i in 0..all.len() {
            let a = all.get_unchecked(i);
            // Compile-time exhaustive destructuring: fails to build if any
            // identity-bearing field is added.
            let StealthAnnouncement {
                ephemeral_pubkey: _,
                view_tag: _,
                announcement_index: _,
                timestamp: _,
            } = a.clone();
        }
    }

    #[test]
    fn test_query_paths_are_only_by_monotonic_index() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        for i in 0..20u8 {
            let pk = secp256k1_compressed_pubkey(&env, i);
            c.publish(&pk, &((i % 4) as u32));
        }

        let count = c.get_announcement_count();
        assert_eq!(count, 20);

        // Full scan — the contract offers no indexed lookup by view_tag or
        // pubkey.  Recipients must walk the full list and filter client-side.
        let page = c.get_announcements_range(&0, &19);
        let mut by_tag: [u32; 4] = [0; 4];
        for i in 0..page.len() {
            let tag = page.get_unchecked(i).view_tag as usize;
            by_tag[tag % 4] += 1;
        }
        assert_eq!(by_tag, [5, 5, 5, 5]);
    }

    #[test]
    fn test_indices_are_purely_sequential_no_clustering() {
        let (env, id, _) = setup();
        let c = client(&env, &id);

        for i in 0..100u8 {
            let pk = secp256k1_compressed_pubkey(&env, i);
            let tag: u32 = if i % 2 == 0 { 0x11 } else { 0x22 };
            let idx = c.publish(&pk, &tag);
            assert_eq!(idx, i as u64);
        }

        let all = c.get_announcements_range(&0, &99);
        for i in 0..all.len() {
            let a = all.get_unchecked(i);
            assert_eq!(a.announcement_index, i as u64);
            let expected_tag: u32 = if i % 2 == 0 { 0x11 } else { 0x22 };
            assert_eq!(a.view_tag, expected_tag);
        }
    }

    // ------------------------------------------------------------------------
    // Edge cases
    // ------------------------------------------------------------------------

    #[test]
    fn test_count_unaffected_by_rejected_publishes() {
        let (env, id, _) = setup();
        let c = client(&env, &id);
        let empty = Bytes::new(&env);
        let empty2 = empty.clone();
        let c2 = StealthAnnouncementContractClient::new(&env, &id);
        assert_panics(move || c2.publish(&empty2, &0u32));

        let pk = secp256k1_compressed_pubkey(&env, 1);
        let idx = c.publish(&pk, &0u32);
        assert_eq!(idx, 0);
        assert_eq!(c.get_announcement_count(), 1);
        let _ = (empty, c); // keep locals alive
    }
}
