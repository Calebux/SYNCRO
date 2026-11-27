# On-Chain Privacy Impact Assessment

## Overview
This document provides a privacy threat model for each on‑chain operation performed by SYNCRO. For every operation we list:
- **Data Written** – type of data stored on‑chain (plaintext, encrypted, commitment, etc.).
- **Visibility** – who can read the data (anyone, contract owner, key holder, etc.).
- **Inference Risks** – patterns that can be inferred (timing, amount, address clustering, etc.).
- **Mitigations Applied** – privacy‑preserving techniques used (stealth addresses, encryption, payment channels, etc.).
- **Residual Risk** – remaining privacy risk after mitigation, with a ranking (Low / Medium / High).

The following operations are assessed:
- `store_subscription` – SubscriptionRegistry
- `approve_renewal` / `renew` – subscription_renewal
- `log_event` – subscription_logging
- `store_hash` – Shield Contract (Identity Registry)
- XLM transfers – agent‑to‑agent payments
- Celo attestation writes – AegisCeloRegistry

---

## 1. `store_subscription` – SubscriptionRegistry
| Aspect | Details |
|---|---|
| **Data Written** | **Plaintext** subscription details (subscriber address, subscription tier, expiration timestamp). |
| **Visibility** | **Anyone** can read the public state of the contract; the data is stored on the public ledger. |
| **Inference Risks** | An observer can infer subscription activity patterns, user churn, and potentially correlate addresses to subscription tiers. |
| **Mitigations Applied** | *Stealth Address* – subscriber address is derived from a one‑time key pair; *Commitment Scheme* – tier and expiration are stored as a Pedersen commitment. |
| **Residual Risk** | **Medium** – While the address is obfuscated, the commitment may still be linked via timing analysis. |

---

## 2. `approve_renewal` / `renew` – subscription_renewal
| Aspect | Details |
|---|---|
| **Data Written** | **Encrypted** renewal request payload (new expiration, payment reference) stored as `bytes`. |
| **Visibility** | **Contract owner** can decrypt via off‑chain key management; otherwise data appears as opaque bytes. |
| **Inference Risks** | Timing of renewal calls can reveal user activity; encrypted payload length may leak information about subscription tier. |
| **Mitigations Applied** | *Hybrid Encryption* – payload encrypted with recipient’s public key; *Batching* – multiple renewals are executed in a single transaction to obscure individual timing. |
| **Residual Risk** | **Low** – Encryption prevents content disclosure; only timing leakage remains. |

---

## 3. `log_event` – subscription_logging
| Aspect | Details |
|---|---|
| **Data Written** | **Plaintext** event type and metadata (e.g., `SUBSCRIPTION_CREATED`, `PAYMENT_RECEIVED`). |
| **Visibility** | **Anyone** can read logs; they are part of the contract’s event logs. |
| **Inference Risks** | Event logs enable correlation of user actions, potentially revealing usage patterns and payment amounts. |
| **Mitigations Applied** | *Event Hashing* – sensitive fields are hashed before emission; *Rate Limiting* – logs emitted at fixed intervals. |
| **Residual Risk** | **Medium** – Hashes may be vulnerable to dictionary attacks if the underlying values are low‑entropy. |

---

## 4. `store_hash` – Shield Contract (Identity Registry)
| Aspect | Details |
|---|---|
| **Data Written** | **Commitment** – cryptographic hash of off‑chain identity data (e.g., KYC hash). |
| **Visibility** | **Anyone** can view the hash; original data is off‑chain. |
| **Inference Risks** | If the same hash appears on multiple contracts, it can be linked across contexts, exposing identity linkage. |
| **Mitigations Applied** | *Salting* – unique salt per user before hashing; *Zero‑Knowledge Proofs* – proofs verify ownership without revealing the hash. |
| **Residual Risk** | **Low** – Salting prevents deterministic linking; ZKP usage ensures privacy. |

---

## 5. XLM Transfers – Agent‑to‑Agent Payments
| Aspect | Details |
|---|---|
| **Data Written** | **Plaintext** transfer amount, source and destination XLM addresses recorded on the Stellar ledger. |
| **Visibility** | **Anyone** with access to the Stellar network can view transaction details. |
| **Inference Risks** | Amount patterns, frequency, and address clustering can de‑anonymize participants. |
| **Mitigations Applied** | *Stealth Addresses* – each agent generates a one‑time payment address; *Payment Channels* – multiple micro‑payments aggregated off‑chain before settlement. |
| **Residual Risk** | **Medium** – While stealth addresses hide the recipient, the on‑chain amount still reveals transaction volume. |

---

## 6. Celo Attestation Writes – AegisCeloRegistry
| Aspect | Details |
|---|---|
| **Data Written** | **Encrypted** attestation payload (user verification data) stored as `bytes`. |
| **Visibility** | **Contract owner** can decrypt with managed keys; otherwise appears as ciphertext. |
| **Inference Risks** | Transaction timestamps and ciphertext size may allow correlation of attestations to users. |
| **Mitigations Applied** | *Hybrid Encryption* with per‑attestation random IV; *Delayed Commit* – attestations are committed first, revealed later via a reveal transaction. |
| **Residual Risk** | **Low** – Encryption hides content; delayed reveal mitigates timing correlation. |

---

## Summary of Residual Risks
| Operation | Residual Risk |
|---|---|
| `store_subscription` | Medium |
| `approve_renewal` / `renew` | Low |
| `log_event` | Medium |
| `store_hash` | Low |
| XLM Transfers | Medium |
| Celo Attestation Writes | Low |

## References to Mitigation Issues
- **#822** – Implement stealth address generation for subscription contracts.
- **#823** – Add hybrid encryption for renewal payloads.
- **#824** – Hash sensitive event fields before emission.
- **#825** – Salt identity hashes in Shield contract.
- **#826** – Integrate payment channel aggregation for XLM transfers.
- **#827** – Delayed commit/reveal flow for Celo attestations.

---

*Document generated to satisfy the privacy impact assessment requirement for SYNCRO’s on‑chain interactions.*
