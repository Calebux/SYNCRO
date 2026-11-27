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
 *           example: exact
 *         network:
 *           type: string
 *           example: eip155:84532
 *         amount:
 *           type: string
 *           example: "10000"
 *         asset:
 *           type: string
 *           example: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
 *         payTo:
 *           type: string
 *           example: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"
 *         maxTimeoutSeconds:
 *           type: integer
 *           example: 60
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
 *           description: Scheme-specific signed payment data
 *     X402SettlementResponse:
 *       type: object
 *       description: Decoded PAYMENT-RESPONSE header payload (x402 V2)
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         transaction:
 *           type: string
 *           example: "0xabc123..."
 *         network:
 *           type: string
 *           example: eip155:84532
 */
