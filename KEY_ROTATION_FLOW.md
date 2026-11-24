# Settlement Signing Key: Custody, Rotation, and Compromise Response

This document defines how the settlement service's channel-state signing key is
custodied, rotated, and recovered from compromise. It supersedes the earlier
subscription-era flow. The settlement key signs channel states and authorizes
value-moving transactions, so its handling is higher-stakes than the
subscription key it replaces.

## 1. Where the key lives (per environment)

| Environment | Key location | Readable from application code? |
|-------------|--------------|---------------------------------|
| local       | `.env` / dev keystore file, git-ignored | Yes (dev only) |
| test / CI   | ephemeral fixture key generated per run | Yes (throwaway) |
| staging     | KMS/HSM-backed signer, key material never exported | No |
| production  | KMS/HSM-backed signer, key material never exported | No |

**Production rule:** the private key material MUST NOT be readable from
application code. The settlement service never holds the raw key; it holds only
a *key handle* (KMS key id / HSM slot) and asks the signer to sign a digest.

- The signer is reached over an authenticated, mutually-TLS channel.
- The service process has `sign` permission only — never `export` or `get`.
- No environment variable, config file, or secret mount in production may
  contain the raw private key. Startup fails closed if a raw key is detected.
- Local/test may use a file-backed signer, but that signer is compiled out of
  the production build path and refuses to start when `NODE_ENV=production`.

## 2. Rotation without closing open channels

Rotation replaces the *active* signing key while channels remain open. It does
not require closing or re-opening any channel.

1. **Provision** the new key in the signer and register it as `pending`.
2. **Dual-sign window:** the service begins signing new states with the new key
   while still accepting states signed by the previous key. Both keys are
   `valid` during this window.
3. **In-flight states:** any state already signed by the old key remains valid
   because validity is checked against the set of *currently valid* keys, not
   against a single active key. A state is accepted if it verifies against any
   key in the valid set and its `keyId` is not revoked.
4. **Promote:** once no in-flight state references the old key (or the dual-sign
   window elapses), mark the new key `active` and the old key `retired`.
5. **Retire:** a `retired` key can no longer sign new states but still verifies
   old ones until every channel that used it has settled. Only then is it
   `revoked`.

Key states: `pending` → `active` → `retired` → `revoked`.

- `pending`: provisioned, not yet signing.
- `active`: signs new states.
- `retired`: verifies old states only; never signs.
- `revoked`: rejected everywhere; only used in compromise response.

Rotation is exercised end to end in staging before any production rotation.

## 3. Compromise response

If a signing key is suspected or confirmed compromised:

1. **Revoke immediately (target: < 5 minutes).** Mark the compromised key
   `revoked` in the signer. From this point the service rejects any state
   signed by it, including previously valid in-flight states.
2. **Promote a replacement.** Activate a pre-provisioned `pending` key so the
   service can keep signing. If none exists, provision one before resuming.
3. **What is revoked:** the compromised key handle and any derived credentials
   (signer session tokens, mTLS certs bound to that key).
4. **What must be closed:** every channel whose latest state was signed by the
   compromised key and has not yet settled on-chain. These are closed using the
   last state both parties agree on, or disputed on-chain if the counterparty
   disagrees. Channels already settled on-chain are unaffected.
5. **Notify** counterparties and the on-call channel within the same window so
   they stop accepting the compromised key.
6. **Post-mortem** within 24 hours: how the key leaked, blast radius, and
   whether the signer boundary needs tightening.

## 4. Never logged, never in payloads, never in dumps

- The raw key and any signer session token are **never** written to logs,
  metrics, traces, or error payloads. Only the non-secret `keyId` may appear.
- Errors from the signer are mapped to opaque codes before leaving the signer
  client; the underlying message is dropped, not wrapped and re-thrown.
- Crash dumps and core files must not contain key material: the service never
  holds it in process memory, so there is nothing to dump. Local/test signers
  that do hold material are excluded from production crash reporting.
- A redaction guard runs over log and error serialization and fails closed if a
  value matching the key/token shape is about to be emitted.

## Done criteria

- Rotation exercised end to end in staging (provision → dual-sign → promote →
  retire) with open channels staying open.
- Compromise runbook (section 3) reviewed and on-call accessible.
- Production startup verified to fail closed when a raw key is present.
