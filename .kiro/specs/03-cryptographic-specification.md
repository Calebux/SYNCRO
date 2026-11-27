# 03 — Cryptographic Specification

This document specifies the cryptographic primitives, key derivation, and
signature schemes used across the protocol. It is normative: implementations
MUST follow it exactly to interoperate.

## 1. Primitives

- Hash: SHA-256.
- Signatures: Ed25519.
- Key agreement: X25519 (where applicable).
- Encoding: canonical JSON (sorted keys, no insignificant whitespace) for all
  signed payloads.

## 2. Key derivation

All long-lived keys are derived from a 32-byte master seed via HKDF-SHA256 with
an explicit, domain-separated `info` string:

```
key = HKDF-SHA256(seed, salt = "", info = "<domain>" || 0x00 || <context>)
```

Domains are versioned (e.g. `v3/channel`, `v3/settlement`). A key derived for
one domain MUST NOT be reused in another.

## 3. Signatures

Every signed message is prefixed with a domain tag to prevent cross-protocol
replay:

```
sig = Ed25519.sign(sk, "<domain>" || 0x00 || canonical_json(payload))
```

Verifiers MUST reject signatures whose domain tag does not match the expected
context.

## 4. Idempotency

Idempotency is a data-layer property, not a per-route concern. It is defined
once here and applied uniformly by admission, metering, and settlement.

### 4.1 Call idempotency key

The idempotency key for a call is derived deterministically from the request:

```
call_idem_key = SHA-256(
  "v3/call-idem" || 0x00 ||
  canonical_json({
    caller,        // authenticated caller identity
    route,         // normalized route identifier
    body_hash,     // SHA-256 of canonical_json(request_body)
    nonce          // caller-supplied request nonce
  })
)
```

`body_hash` binds the key to the exact request body. The key is stable across
retries of the same logical call and distinct for any change in caller, route,
body, or nonce.

**Retention window.** Idempotency records are retained for `IDEM_RETENTION`
(default 24h, configurable) after first observation. A key observed again
within the window is a retry; after the window it is treated as a new call.
Retention MUST exceed the maximum client retry horizon.

### 4.2 Metering

The meter increment is idempotent under `call_idem_key`. The meter stores, per
key, the recorded usage and the `body_hash` it was recorded against. An
increment for an already-seen key is a no-op that returns the previously
recorded result; it MUST NOT increment usage again.

### 4.3 Settlement (channel state)

Channel-state submission is idempotent under the state nonce. Each submitted
state carries a monotonically increasing `state_nonce`. The channel records the
highest applied nonce and the resulting balance. A submission whose nonce is
less than or equal to the highest applied nonce is a no-op: it MUST NOT debit
the channel again and MUST return the current channel state. Only a strictly
higher nonce advances the channel.

### 4.4 Conflicting bodies

If the same `call_idem_key` arrives with a different request body (i.e. a
`body_hash` that does not match the recorded one), the request MUST be rejected
as a conflict (`409`-class error). The system MUST NOT silently apply the new
body, and MUST NOT overwrite the recorded usage. This guarantees that a key
unambiguously identifies one logical call.

### 4.5 Crash between meter and settle

Metering and settlement are separate steps and a crash may occur between them.
The meter record is written and committed before settlement is attempted, and
settlement is idempotent under the state nonce (§4.3). On recovery:

- If the meter recorded usage but settlement did not complete, the settlement
  is retried with the same state nonce; the retry either applies once or is a
  no-op if it had already applied.
- If settlement completed but the meter record was not observed, replaying the
  call re-derives the same `call_idem_key`; the meter increment is a no-op and
  settlement is a no-op under the nonce.

Thus a crash at any point leaves the system consistent: the balance equals the
balance of the deduplicated sequence of calls.

### 4.6 Correctness property

For any sequence of calls with arbitrary duplicates and injected crashes, the
resulting channel balance MUST equal the balance obtained by applying the
deduplicated sequence exactly once. This property is enforced by a property
test that replays arbitrary call sequences with duplicates and crashes injected
and asserts balance equality against the deduplicated sequence.
