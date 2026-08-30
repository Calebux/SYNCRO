# Bugfix Requirements Document

## Introduction

x402-gated agent endpoints accept any structurally valid `PAYMENT-SIGNATURE` header without
checking whether the proof has been used before. An attacker who captures a legitimate 402
receipt (containing a nonce and an expiry timestamp) can replay it an unlimited number of
times against the same endpoint, bypassing the payment requirement entirely. This fix
introduces a server-side nonce store with TTL so that each payment proof can only be
accepted once within its validity window.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a request arrives at an x402-gated endpoint with a `PAYMENT-SIGNATURE` header
    whose nonce has already been used within the proof's validity window THEN the system
    grants access to the protected resource without rejecting the replayed proof.

1.2 WHEN a captured `PAYMENT-SIGNATURE` (nonce + expiry) is submitted by any client after
    the original legitimate use THEN the system processes the request as if it were a fresh,
    valid payment proof.

1.3 WHEN no nonce store exists THEN the system has no mechanism to detect or reject
    previously seen payment proofs, leaving all x402-gated endpoints vulnerable to replay
    attacks.

### Expected Behavior (Correct)

2.1 WHEN a request arrives at an x402-gated endpoint with a `PAYMENT-SIGNATURE` header
    whose nonce has already been recorded in the nonce store THEN the system SHALL reject
    the request with HTTP 402 and an error indicating the payment proof has already been used.

2.2 WHEN a request arrives at an x402-gated endpoint with a `PAYMENT-SIGNATURE` header
    containing a nonce that has not been seen before and has not expired THEN the system
    SHALL record the nonce in the nonce store with a TTL equal to the proof's expiry window
    and grant access to the protected resource.

2.3 WHEN a request arrives at an x402-gated endpoint with a `PAYMENT-SIGNATURE` header
    whose embedded expiry timestamp is in the past THEN the system SHALL reject the request
    with HTTP 402 and an error indicating the payment proof has expired, without recording
    the nonce.

2.4 WHEN a `PAYMENT-SIGNATURE` header is absent on a request to an x402-gated endpoint
    THEN the system SHALL reject the request with HTTP 402 and a `PAYMENT-REQUIRED` header
    describing the accepted payment schemes.

2.5 WHEN the nonce store TTL for a recorded nonce expires THEN the system SHALL evict the
    nonce entry so that storage does not grow unboundedly.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a request arrives at a non-x402-gated endpoint THEN the system SHALL CONTINUE TO
    process the request using its existing authentication and authorization logic, unaffected
    by the nonce store.

3.2 WHEN a valid, first-use `PAYMENT-SIGNATURE` is submitted to an x402-gated endpoint
    THEN the system SHALL CONTINUE TO grant access and return the expected resource response
    with HTTP 200.

3.3 WHEN an x402-gated endpoint receives a request with an invalid cryptographic signature
    in the `PAYMENT-SIGNATURE` header (but a fresh nonce) THEN the system SHALL CONTINUE TO
    reject it with HTTP 402 due to signature invalidity, not replay.

3.4 WHEN the existing `IdempotencyService` deduplicates client-initiated API operations THEN
    that behavior SHALL CONTINUE TO function independently and is not replaced by the nonce
    store introduced by this fix.

3.5 WHEN the `PAYMENT-REQUIRED` header is returned on a 402 response THEN the system SHALL
    CONTINUE TO include `maxTimeoutSeconds` in the accepted payment requirements, and the
    documented replay-protection window SHALL match that value.

---

## Bug Condition Pseudocode

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type PaymentProof { nonce: string, expiresAt: timestamp }
  OUTPUT: boolean

  // Returns true when the proof triggers the replay vulnerability
  RETURN nonceStore.contains(X.nonce) OR X.expiresAt < now()
END FUNCTION
```

```pascal
// Property: Fix Checking — replayed proof must be rejected
FOR ALL X WHERE isBugCondition(X) DO
  result ← x402Middleware'(X)
  ASSERT result.status = 402
  ASSERT result.error IN { "payment proof already used", "payment proof expired" }
END FOR
```

```pascal
// Property: Preservation Checking — fresh valid proofs must still succeed
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT x402Middleware(X) = x402Middleware'(X)   // behavior unchanged
END FOR
```
