#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Symbol};

    fn setup() -> (Env, AttestationContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AttestationContract, ());
        let client = AttestationContractClient::new(&env, &id);
        let issuer = Address::generate(&env);
        client.init(&issuer).unwrap();
        (env, client, issuer)
    }

    fn digest(env: &Env, seed: u8) -> BytesN<32> {
        let mut b = [0u8; 32]; b[0] = seed; b[31] = seed.wrapping_add(1);
        BytesN::from_array(env, &b)
    }

    #[test] fn test_issue_and_verify() {
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let atype   = Symbol::new(&env, "KYC_BASIC");
        let d       = digest(&env, 1);
        client.issue(&subject, &atype, &d).unwrap();
        assert!(client.verify(&subject, &atype, &d));
    }

    #[test] fn test_wrong_digest_fails_verify() {
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let atype   = Symbol::new(&env, "KYC_BASIC");
        client.issue(&subject, &atype, &digest(&env, 1)).unwrap();
        assert!(!client.verify(&subject, &atype, &digest(&env, 2)));
    }

    #[test] fn test_revoke_blocks_verify() {
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let atype   = Symbol::new(&env, "KYC_BASIC");
        let d       = digest(&env, 3);
        client.issue(&subject, &atype, &d).unwrap();
        client.revoke(&subject, &atype).unwrap();
        assert!(!client.verify(&subject, &atype, &d));
    }

    #[test] fn test_double_revoke_errors() {
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let atype   = Symbol::new(&env, "AML");
        client.issue(&subject, &atype, &digest(&env, 4)).unwrap();
        client.revoke(&subject, &atype).unwrap();
        assert_eq!(client.revoke(&subject, &atype), Err(AttestError::Revoked));
    }

    #[test] fn test_revoke_nonexistent_errors() {
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let atype   = Symbol::new(&env, "KYC_BASIC");
        assert_eq!(client.revoke(&subject, &atype), Err(AttestError::NotFound));
    }

    #[test] fn test_zero_digest_rejected() {
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let atype   = Symbol::new(&env, "KYC_BASIC");
        let zero    = BytesN::from_array(&env, &[0u8; 32]);
        assert_eq!(client.issue(&subject, &atype, &zero), Err(AttestError::InvalidDigest));
    }

    #[test] fn test_double_init_errors() {
        let (env, client, _) = setup();
        let another = Address::generate(&env);
        assert_eq!(client.init(&another), Err(AttestError::AlreadyInit));
    }

    #[test] fn test_no_pii_on_chain() {
        // Verify only BytesN<32> digest is stored, not raw subject data beyond the Address.
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let atype   = Symbol::new(&env, "KYC_FULL");
        let d       = digest(&env, 5);
        client.issue(&subject, &atype, &d).unwrap();
        let record = client.get_record(&subject, &atype).unwrap();
        assert_eq!(record.digest, d);
        assert!(!record.revoked);
        // The record contains only digest + ledger seq + revoked flag – no name/DOB/etc.
    }

    #[test] fn test_multiple_attestation_types_independent() {
        let (env, client, _) = setup();
        let subject = Address::generate(&env);
        let kyc = Symbol::new(&env, "KYC");
        let aml = Symbol::new(&env, "AML");
        let d1  = digest(&env, 6);
        let d2  = digest(&env, 7);
        client.issue(&subject, &kyc, &d1).unwrap();
        client.issue(&subject, &aml, &d2).unwrap();
        client.revoke(&subject, &kyc).unwrap();
        assert!(!client.verify(&subject, &kyc, &d1)); // revoked
        assert!( client.verify(&subject, &aml, &d2)); // still active
    }
}
