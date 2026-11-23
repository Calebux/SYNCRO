/**
 * @openapi
 * components:
 *   headers:
 *     PaymentRequired:
 *       description: |
 *         x402 V2 server header. Base64-encoded JSON `PaymentRequired` object returned
 *         with HTTP 402 responses describing accepted payment schemes.
 *       schema:
 *         type: string
 *         example: eyJ4NDAyVmVyc2lvbiI6Mn0=
 *     PaymentSignature:
 *       description: |
 *         x402 V2 client header. Base64-encoded JSON `PaymentPayload` proving payment
 *         authorization. Retried on the original request after receiving 402.
 *       schema:
 *         type: string
 *         example: eyJ4NDAyVmVyc2lvbiI6Mn0=
 *     PaymentResponse:
 *       description: |
 *         x402 V2 settlement header. Base64-encoded JSON `SettlementResponse` describing
 *         on-chain settlement outcome after payment verification.
 *       schema:
 *         type: string
 *         example: eyJzdWNjZXNzIjp0cnVlfQ==
 *   parameters:
 *     PaymentSignatureHeader:
 *       name: PAYMENT-SIGNATURE
 *       in: header
 *       required: false
 *       description: |
 *         x402 payment authorization header (Base64-encoded PaymentPayload JSON).
 *         Required when retrying a request after receiving HTTP 402 with PAYMENT-REQUIRED.
 *       schema:
 *         type: string
 *       example: eyJ4NDAyVmVyc2lvbiI6MiwicGF5bG9hZCI6e319
 *     PaymentRequiredHeader:
 *       name: PAYMENT-REQUIRED
 *       in: header
 *       required: false
 *       description: |
 *         x402 payment requirements header (Base64-encoded PaymentRequired JSON).
 *         Returned by the server on HTTP 402 responses.
 *       schema:
 *         type: string
 *   schemas:
 *     X402PaymentRequired:
 *       type: object
 *       description: Decoded PAYMENT-REQUIRED header payload (x402 V2)
 *       properties:
 *         x402Version:
 *           type: integer
 *           example: 2
 *         error:
 *           type: string
 *           example: PAYMENT-SIGNATURE header is required
 *         resource:
 *           type: object
 *           properties:
 *             url:
 *               type: string
 *               format: uri
 *               example: https://api.syncro.app/api/payments/paystack/initialize
 *             description:
 *               type: string
 *               example: Initialize wallet funding transaction
 *             mimeType:
 *               type: string
 *               example: application/json
 *         accepts:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/X402PaymentRequirements'
 *     X402PaymentRequirements:
 *       type: object
 *       properties:
 *         scheme:
 *           type: string
 *           description: |
 *             Payment scheme. SYNCRO advertises `exact` on Stellar: the caller
 *             pays the reserved amount for the call. See docs/x402-compatibility.md.
 *           example: exact
 *         network:
 *           type: string
 *           description: CAIP-2-style network id. SYNCRO uses `stellar:<network>`.
 *           example: stellar:testnet
 *         amount:
 *           type: string
 *           example: "10"
 *         asset:
 *           type: string
 *           description: Stellar asset id (code + issuer). Replaces the EVM contract address.
 *           example: USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 *         payTo:
 *           type: string
 *           description: Provider payment-channel address (not an externally-owned account).
 *           example: G_PROVIDER_CHANNEL_DEFAULT
 *         maxTimeoutSeconds:
 *           type: integer
 *           example: 300
 *         extra:
 *           type: object
 *           description: SYNCRO-only challenge fields preserved for observability.
 *           properties:
 *             syncroScheme:
 *               type: string
 *               example: channel-state
 *             challengeId:
 *               type: string
 *               example: chal_1f2e3d4c5b6a
 *             contract:
 *               type: string
 *               example: C_CONFIGURED_CONTRACT
 *             rate:
 *               type: string
 *               example: "0.1"
 *             nonce:
 *               type: string
 *               example: ch_nonce_…
 *             expiresAt:
 *               type: string
 *               format: date-time
 *               example: "2026-01-01T00:00:00.000Z"
 *     X402PaymentPayload:
 *       type: object
 *       description: Decoded PAYMENT-SIGNATURE header payload (x402 V2)
 *       properties:
 *         x402Version:
 *           type: integer
 *           example: 2
 *         accepted:
 *           $ref: '#/components/schemas/X402PaymentRequirements'
 *         payload:
 *           type: object
 *           description: |
 *             Scheme-specific signed data. In SYNCRO compatibility mode this
 *             carries a channel-state proof (`channelId`, `sequenceNumber`,
 *             balances, `nonce`, `payerAddress`, `signature`).
 *     X402SettlementResponse:
 *       type: object
 *       description: Decoded PAYMENT-RESPONSE header payload (x402 V2)
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         transaction:
 *           type: string
 *           description: |
 *             On-chain settlement reference. Until the channel batch settles,
 *             SYNCRO returns the receipt id here.
 *           example: rcpt_1a2b3c4d5e6f
 *         network:
 *           type: string
 *           example: stellar:testnet
 */
