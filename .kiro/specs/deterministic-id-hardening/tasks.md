# Deterministic ID Hardening — Tasks

## Idempotency keys across admission, metering, and settlement (#1419)

- [ ] **Define the call idempotency key.** Derive it deterministically from the request: `idempotencyKey = H(method, path, canonicalJson(body), callerId)`. The key is computed once at admission and carried through metering and settlement. Retention window: keys are retained for `IDEMPOTENCY_RETENTION` (default 24h, aligned with the settlement window) after the call reaches a terminal state; after that the key may be evicted and a replay is treated as a fresh call.
- [ ] **Idempotent meter increment.** Metering writes are keyed by the call idempotency key. A retried call with the same key must not increment the meter twice: the meter store records `(idempotencyKey -> meterDelta)` and a duplicate key is a no-op that returns the previously recorded delta.
- [ ] **Idempotent channel-state submission.** Channel-state submissions are keyed by the state nonce. A duplicate submission under the same nonce is a no-op rather than a double debit: the settlement store records `(nonce -> appliedState)` and rejects re-application of an already-applied nonce.
- [ ] **Same key, different body.** If the same idempotency key arrives with a different request body (canonical hash mismatch), reject with a conflict error (`409 IDEMPOTENCY_KEY_REUSED`) instead of silently applying the new body. The original result is never overwritten.
- [ ] **Crash between meter and settle.** Metering and settlement are recorded as separate, individually idempotent steps under the same call key. On recovery, a call that was metered but not settled is re-driven from the settlement step; because both steps are idempotent under the key, replaying either step is safe and the balance converges to the deduplicated result.
- [ ] **Property test.** Replay arbitrary call sequences with duplicates and injected crashes; assert the resulting balance always equals the balance of the deduplicated sequence.
