# ADR-019: Multi-Protocol HTTP 402 Payment Negotiation

**Status:** Proposed
**Date:** 2026-11-23
**Deciders:** SYNCRO maintainers
**Issue:** Cross-protocol payment negotiation

---

## Context

SYNCRO currently uses an HTTP `402 Payment Required` flow modeled on x402 v2: a
`PAYMENT-REQUIRED` challenge lists accepted payment options, a retry carries
`PAYMENT-SIGNATURE`, and a successful response carries `PAYMENT-RESPONSE`.
The paid-call journey in `client/e2e/agent-metered-journey.spec.ts` demonstrates
this exchange.

Two other agent-payment approaches are relevant:

- **MPP** (Machine Payments Protocol) uses HTTP authentication in the
  `Payment` scheme. A challenge is returned in `WWW-Authenticate`, the client
  retries with `Authorization: Payment <credential>`, and the server returns a
  `Payment-Receipt` header. MPP is payment-method and settlement-rail agnostic;
  implementations can plug in Stripe, Tempo, Stellar, Lightning, or another rail.
- **Lightning L402** returns a macaroon and BOLT11 invoice in
  `WWW-Authenticate: L402 ...`. The payer returns a bearer macaroon plus invoice
  preimage in `Authorization: L402 <macaroon>:<preimage>`. Settlement is the
  Lightning payment; the macaroon/preimage pair is the access credential, not
  a conventional transaction receipt.

This ADR does not define a wire implementation. It decides whether SYNCRO should
surface these protocols as alternatives in a single 402 negotiation step.

## Survey

| Protocol | Challenge | Settlement | Receipt / proof | Interoperability assessment |
|---|---|---|---|---|
| x402 v2 | Base64-encoded JSON in `PAYMENT-REQUIRED`; `accepts` arrays payment schemes | Scheme/network dependent; exact and upto generally immediate, batch settlement can be deferred | Base64-encoded `PAYMENT-RESPONSE` settlement result | Canonical SYNCRO baseline; already represented by SDK and e2e coverage |
| MPP | HMAC-bound HTTP challenge in `WWW-Authenticate: Payment ...`; credentials in `Authorization: Payment ...` | Settlement method is pluggable; implementations vary by method and may settle immediately or after verification | `Payment-Receipt` with implementation-specific reference | Standards-aligned option, but the specification and implementations are still evolving |
| L402 | `WWW-Authenticate: L402 macaroon="...", invoice="..."` | Lightning Network invoice settlement | Macaroon plus SHA-256 preimage; bearer access credential | Useful Lightning interoperability, but its challenge, credential, and receipt semantics do not fit SYNCRO channel settlement records |

Protocol references:

- x402 HTTP 402: https://docs.x402.org/core-concepts/http-402
- MPP specification: https://github.com/tempoxyz/mpp-specs
- MPP IETF draft: https://datatracker.ietf.org/doc/draft-ryan-httpauth-payment/
- Public MPP implementation guide: https://github.com/inference-sh/mpp
- L402 specification: https://github.com/lightninglabs/L402
- Lightning Engineering L402 guide: https://docs.lightning.engineering/the-lightning-network/l402

## Decision

SYNCRO should support **protocol negotiation at the provider boundary**, but it
should advertise alternatives without collapsing their semantics into one
common credential or settlement object.

A 402 response may contain more than one protocol option when a provider enables
it. Each option must remain standards-native:

- SYNCRO/x402: `PAYMENT-REQUIRED` and the existing x402 retry/response headers.
- MPP: `WWW-Authenticate: Payment ...` and MPP retry/receipt headers.
- L402: `WWW-Authenticate: L402 ...` and L402 retry credentials.

The response must not promise settlement or a receipt for one protocol by
embedding it in another protocol's fields. SYNCRO SDKs must select a supported,
configured option and then return protocol-specific settlement information in the
canonical SYNCRO receipt model only after normalization and reconciliation.

### Protocol decisions

| Protocol | Decision | Rationale |
|---|---|---|
| **x402** | **GO — canonical baseline** | It already matches SYNCRO HTTP and SDK behavior; it has an explicit structured settlement response and can carry several accepted options in `accepts` |
| **MPP** | **GO — phased implementation** | The challenge/credential/receipt model is compatible with a common negotiation pattern, and Stellar payment-method work exists. Integration should wait until the specification, receipt shape, replay rules, and MPP Stellar implementation are pinned by tests |
| **L402** | **NO-GO for the first implementation** | Lightning settlement and macaroon/preimage bearer semantics are distinct from SYNCRO channels and signed SYNCRO receipts. Revisit after a non-custodial Lightning settlement adapter and macaroons replay/integration model are specified |

### Recommendation

GO for advertising multiple payment options **at the provider boundary**, with
SYNCRO/x402 first and MPP as a gated second option. Do not advertise L402 until
the separate adapter work is approved. A 402 response that offers only x402 is
valid and remains the default.

Providers opt into alternatives explicitly. SYNCRO must never silently choose a
payment rail or change the payer's asset, settlement latency, or network.

## Domain Naming & Data Model Compliance

| Domain Term / Entity | Layer Affected | Proposed Representation | Alignment |
|---|---|---|---|
| **Payment** | API, SDK, receipt DTO | Protocol-specific authorization first; normalized payment result second | Preserve protocol proof; do not overwrite canonical payment state |
| **Charge** | Provider routes, pricing | One provider charge may map to selected protocol option | The protocol option is transport; charge remains route-derived |
| **Settlement** | Settlement records | x402 settlement or MPP settlement reference is a settlement source; L402 deferred | Channel settlement totals remain reconciled independently |
| **Channel** | Channel/payment state | SYNCRO channel is one settlement path, not the 402 negotiation envelope | No change in channel trust model |
| **Receipt** | SDK/client response | Canonical normalized receipt plus protocol-specific raw reference | Prevent receipt ambiguity across protocols |

## Technical Details & Architecture Impact

### HTTP behavior

- Keep `402` as the transport control response.
- Keep protocol-native challenge and credential headers.
- Do not merge MPP or L402 fields into x402's `accepts` array.
- Add a provider capability table or configuration before an implementation PR.

### Security

- Bind MPP/x402 challenges to resource, method, amount, asset, expiry, and
  replay protection.
- Reject credentials that do not correspond to the exact request and configured
  provider.
- Store protocol references only after successful verification or settlement.
- Apply bearer-credential replay rules per protocol; never treat a Lightning
  preimage as a SYNCRO transaction hash.

### API and SDK

- Shared receipt types must remain protocol-neutral but may carry a
  `protocol` discriminator and protocol-specific evidence.
- An implementation PR should add an adapter interface, not direct protocol
  conditionals throughout the SDK.
- There is no database migration or smart-contract change in this ADR.

## Consequences

### Positive

- Preserves existing SYNCRO/x402 behavior.
- Provides a clear standards-native path for MPP compatibility.
- Prevents L402's bearer credential and settlement semantics from being
  misrepresented as a SYNCRO settlement.
- Makes provider opt-in and payer choice explicit.

### Negative / Trade-offs

- A 402 response can become harder for clients to parse across protocols.
- MPP settlement and receipt fields are implementation-dependent.
- L402 interoperability remains deferred until later work.
- Protocol negotiation adds configuration and adapter-maintenance cost.

## Compliance Checklist

- [ ] Protocol-specific DTOs remain outside the canonical ledger model.
- [ ] Provider opt-in is explicit.
- [ ] MPP implementation pins a tested version and Stellar settlement adapter.
- [ ] L402 work remains unimplemented until a dedicated adapter ADR is approved.
