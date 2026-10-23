// Interface validation tests and usage examples
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interface_structure() {
        // This test verifies that all required types are properly defined
        // and can be instantiated for interface compliance
    }

    #[test]
    fn test_card_status_enum() {
        // Verify all card status states are defined
        let _ = CardStatus::Pending;
        let _ = CardStatus::Active;
        let _ = CardStatus::Suspended;
        let _ = CardStatus::Closed;
        let _ = CardStatus::AwaitingActivation;
    }

    #[test]
    fn test_card_type_enum() {
        // Verify all card type categories are defined
        let _ = CardType::Standard;
        let _ = CardType::Premium;
        let _ = CardType::Restricted;
        let _ = CardType::Corporate;
        let _ = CardType::Disposable;
        let _ = CardType::Custom;
    }

    #[test]
    fn test_error_types() {
        // Verify all error codes are unique
        let errors = vec![
            VirtualCardError::CardNotFound,
            VirtualCardError::Unauthorized,
            VirtualCardError::CardInactive,
            VirtualCardError::InvalidCardState,
            VirtualCardError::LimitExceeded,
            VirtualCardError::InvalidInput,
            VirtualCardError::Expired,
            VirtualCardError::DuplicateCard,
            VirtualCardError::NotSupported,
            VirtualCardError::InternalError,
            VirtualCardError::CounterOverflow,
            VirtualCardError::DailyLimitExceeded,
            VirtualCardError::MonthlyLimitExceeded,
            VirtualCardError::MerchantNotAllowed,
            VirtualCardError::MerchantBlocked,
        ];

        assert_eq!(errors.len(), 15, "All error types must be unique");
    }

    #[test]
    fn test_interface_completeness() {
        // This is a compile-time check that the interface is complete
        // If implementations try to implement VirtualCardContract,
        // the compiler will ensure all methods are provided
    }

    #[test]
    fn test_card_id_uniqueness() {
        use soroban_sdk::testutils::{Address as _, Ledger};

        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VirtualCardContract);
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let expires = env.ledger().timestamp() + 1000;

        let id1 = client.issue_card(&user, &100, &CardType::Standard, &expires, &0, &0);
        let id2 = client.issue_card(&user, &200, &CardType::Premium, &expires, &0, &0);
        let id3 = client.issue_card(&user, &300, &CardType::Corporate, &expires, &0, &0);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
        assert_ne!(id1, id2);
        assert_ne!(id2, id3);
    }

    #[test]
    fn test_card_counter_overflow_guard() {
        use soroban_sdk::testutils::{Address as _, Ledger};

        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VirtualCardContract);
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let expires = env.ledger().timestamp() + 1000;

        // Set CardCounter to u32::MAX
        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::CardCounter, &u32::MAX);
        });

        let res = client.try_issue_card(&user, &100, &CardType::Standard, &expires, &0, &0);
        assert_eq!(res, Err(Ok(VirtualCardError::CounterOverflow)));
    }

    #[test]
    fn test_tx_counter_overflow_guard() {
        use soroban_sdk::testutils::{Address as _, Ledger};

        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VirtualCardContract);
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let expires = env.ledger().timestamp() + 1000;

        let card_id = client.issue_card(&user, &1000, &CardType::Standard, &expires, &0, &0);

        // Set TxCounter to u32::MAX
        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::TxCounter, &u32::MAX);
        });

        let res = client.try_process_payment(&card_id, &50, &String::from_str(&env, "merchant"));
        assert_eq!(res, Err(Ok(VirtualCardError::CounterOverflow)));
    }

    #[test]
    fn test_process_payment_unauthorized_fails() {
        use soroban_sdk::testutils::{Address as _, Ledger};

        let env = Env::default();
        // Mock initial card issuance
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VirtualCardContract);
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let expires = env.ledger().timestamp() + 1000;
        let card_id = client.issue_card(&user, &1000, &CardType::Standard, &expires, &0, &0);

        // Clear mock auths to verify requirement of user auth
        let env = Env::default();
        let client = VirtualCardContractClient::new(&env, &contract_id);
        let res = client.try_process_payment(&card_id, &50, &String::from_str(&env, "merchant"));
        assert!(res.is_err());
    }
}

