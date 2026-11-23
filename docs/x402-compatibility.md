# x402 ↔ SYNCRO Compatibility

Issue: [#1822](https://github.com/Calebux/SYNCRO/issues/1822) — x402 interoperability for
challenges and payment headers.

x402 is a common shape for HTTP 402 payments. This document maps SYNCRO's native
channel-state challenge onto x402 `PaymentRequirements`, records where the two
models differ, and states which settlement schemes SYNCRO supports on Stellar.

- Gateway implementation: `backend/src/services/v3/x402-compat.ts`
- Gateway wiring: `backend/src/services/v3/gateway-lifecycle.ts`,
  `backend/src/routes/v3/gateway.ts`
- Consumer SDK: `sdk/src/v3/paid-fetch.ts`
- OpenAPI components: `backend/src/openapi/x402-docs.ts`

## Enabling compatibility mode

Compatibility mode is opt-in per deployment so SYNCRO-native clients are
unaffected when it is off:

```bash
X402_COMPATIBILITY_ENABLED=true
```

When enabled, the gateway:

1. Sets `PAYMENT-REQUIRED` to a signed x402 `PaymentRequired` object whose
   `accepts[]` array describes the route, while still embedding the original
   signed SYNCRO challenge under the `syncro` extension. The response body keeps
   the native `challenge` object for SYNCRO-aware clients.
2. Accepts either a native channel-state proof **or** an x402 `PaymentPayload`
   (whose `payload` carries the channel-state proof) in `PAYMENT-SIGNATURE`.
3. Sets `PAYMENT-RESPONSE` to an x402 `SettlementResponse`
   (`{ success, transaction, network }`) instead of the raw SYNCRO receipt.

When disabled (default), the headers keep their SYNCRO-native shape.

## Field mapping

A SYNCRO challenge (`ChallengeDetails`) maps onto an x402
`PaymentRequirements` entry as follows:

| SYNCRO challenge field | x402 `PaymentRequirements` field | Notes |
|---|---|---|
| `scheme` (`channel-state`) | `scheme` (`exact`) | SYNCRO's channel-state collapses to x402's one-shot `exact` for the reserved amount. See "Model differences". |
| `chain` (`stellar:testnet`) | `network` | Already CAIP-2-shaped (`stellar:<net>`); passed through unchanged. |
| `amount` | `amount` | Decimal string, identical. |
| `settlementAsset` (`USDC:G…`) | `asset` | Stellar asset id (code + issuer) replaces the EVM contract address used in x402 examples. |
| `channelAddress` | `payTo` | SYNCRO pays the provider's payment channel, not an externally-owned account. |
| `expiresAt` | `maxTimeoutSeconds` | Converted to whole seconds remaining. |
| `challengeId`, `contract`, `rate`, `nonce`, `expiresAt` | `extra.*` | SYNCRO-only fields preserved under `extra` for observability. |
| `signature` | — | The challenge signature covers the whole challenge; consumers verify it before paying. |

The reverse direction is used when a client pays: the x402 `PaymentPayload`
carries a SYNCRO channel-state proof under `payload`, and the gateway unwraps it
back into the fields `verifyPaymentProof` expects.

### Example `PAYMENT-REQUIRED` (compatibility mode, decoded)

```json
{
  "x402Version": 2,
  "error": "Payment required: Please provide PAYMENT-SIGNATURE header with valid channel state proof",
  "resource": {
    "url": "https://api.example.com/api/v3/gateway/inference",
    "description": "Paid /api/v3/gateway/inference gateway route",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "10",
      "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "payTo": "G_PROVIDER_CHANNEL_DEFAULT",
      "maxTimeoutSeconds": 300,
      "extra": {
        "syncroScheme": "channel-state",
        "challengeId": "chal_…",
        "contract": "C…",
        "rate": "0.1",
        "nonce": "ch_nonce_…",
        "expiresAt": "2026-01-01T00:00:00.000Z"
      }
    }
  ],
  "syncro": { "challengeId": "chal_…", "scheme": "channel-state", "…": "…", "signature": "…" },
  "signature": "…"
}
```

The top-level `signature` is an Ed25519 signature over the canonicalized object
with `signature` removed; consumers verify it before signing any payment.

## Model differences: channels vs per-call settlement

| Dimension | SYNCRO (native) | x402 (`exact`) |
|---|---|---|
| Settlement unit | A payment channel: many calls, off-chain signed states, batched on-chain settlement. | A single payment per HTTP call. |
| Payer identity | Channel member (`payerAddress`), verified via channel membership. | `payTo` recipient; client authorizes a transfer. |
| Proof | Signed channel-state proof (`channelId`, `sequenceNumber`, balances, `nonce`). | Scheme-specific authorization (e.g. EIP-3009 `transferWithAuthorization` on EVM). |
| Replay protection | Monotonic `sequenceNumber` per channel + single-use `nonce`. | Nonce/permit tied to the authorization. |
| Cost control | Up-front reservation bound; actual usage committed after the call. | Exact amount fixed by `PaymentRequirements.amount`. |
| On-chain timing | Deferred/batched (`SETTLEMENT_*` policy). | Per-call settlement by a facilitator. |

In compatibility mode the gateway presents the reserved amount as an `exact`
requirement so a caller can satisfy one HTTP call. The channel, sequence
monotonicity and batched settlement remain SYNCRO concerns; they are not
expressible in `PaymentRequirements`.

## Scheme decision on Stellar

**Supported:** `exact` (the only scheme advertised on Stellar).

- SYNCRO maps its `channel-state` scheme onto x402 `exact`: the caller pays the
  reserved amount for the call, and the underlying channel state is committed by
  the gateway.
- The SYNCRO channel-state proof is what populates the `payload` of the `exact`
  authorization, because SYNCRO settles through payment channels rather than an
  EIP-3009-style transfer.

**Not supported (recorded):** generic EVM-oriented `exact` authorizations
(EIP-3009 `transferWithAuthorization`) and any scheme that assumes an
externally-owned `payTo` EOA. Stellar has no EIP-3009 equivalent, so a stock
x402 client that only knows how to sign EVM `exact` authorizations cannot settle
a Stellar route.

## Reference client flow (testnet)

A reference x402 client performs the standard 402 dance against a route in
compatibility mode:

1. `POST /api/v3/gateway/inference` → `402` with `PAYMENT-REQUIRED`.
2. Read `accepts[0]` (and, for a SYNCRO-aware client, the `syncro` extension).
3. Build a `PaymentPayload` whose `payload` is a channel-state proof.
4. Retry with `PAYMENT-SIGNATURE: base64(PaymentPayload)`.
5. On success, read `PAYMENT-RESPONSE` (`{ success, transaction, network }`).

The backend test `backend/tests/v3-x402-compat.test.ts` runs this exact sequence
against a testnet-configured gateway and is the executable proof of the flow.

### Why full on-chain settlement is out of scope for this PR

`exact` on Stellar would require a Stellar x402 **facilitator** that verifies a
scheme-specific authorization and submits the on-chain transfer (the analogue of
the EVM facilitator). SYNCRO does not run one: it settles through its payment
channels with deferred batching, so the gateway verifies the channel-state proof
and commits the meter, and settlement happens through the existing channel
batching path. This PR therefore delivers protocol compatibility (challenges and
payment headers) on testnet and records the missing piece — a Stellar
facilitator — as the reason a stock EVM-style `exact` client cannot fully settle
on-chain. On testnet the proof-acceptance path also honours the existing stub
signature conventions used by `verifyPaymentProof`.

## Non-goals

- Running an x402 facilitator or changing SYNCRO's settlement model.
- Advertising schemes (e.g. EVM `exact`, `upto`) that Stellar cannot express.
- Replacing the SYNCRO-native challenge for clients that do not opt in.
