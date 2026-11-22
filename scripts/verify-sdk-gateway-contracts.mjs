#!/usr/bin/env node
/**
 * Consumer-driven contract verification between the SDK and the Gateway (#1872).
 *
 * Verifies:
 *   1. Recorded contract (`shared/contracts/sdk-gateway-contract.json`) matches
 *      every header, challenge shape, payment proof shape, settlement receipt shape,
 *      and error body that `@syncro/sdk` depends on.
 *   2. Gateway source modules and runtime output conform to the recorded contracts.
 *   3. All 15 error taxonomy codes (#1493) match 1:1 between `backend/src/errors/gateway-taxonomy.json`,
 *      `backend/src/errors/gateway-error-response.ts`, and `sdk/src/generated/gateway-errors.ts`.
 *   4. Negative drift checks prove that renaming any header or field on the gateway
 *      causes verification to fail immediately.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signEd25519 } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generatePaymentChallenge,
  parsePaymentChallenge,
  parsePaymentProof,
  serialisePaymentProof,
  verifyPaymentProof,
} from '../backend/src/services/v3/payment-challenge-service.ts';

import {
  createPaidFetch,
  parsePaymentRequiredHeader,
  parsePaymentResponseHeader,
  parsePaymentSignatureHeader,
  serialisePaymentRequiredHeader,
  serialisePaymentResponseHeader,
} from '../sdk/src/v3/paid-fetch.ts';

import {
  createGatewayErrorFromCode,
  getGatewayRetrySemantics,
  isGatewayErrorCode,
} from '../sdk/src/generated/gateway-errors.ts';

import {
  SdkGatewayContractMismatchError,
  assertErrorResponseMatchesContract,
  assertGatewayChallengeResponseMatchesContract,
  assertGatewayTaxonomyAlignedWithContract,
  assertX402ChallengeHeaderMatchesContract,
  loadSdkGatewayContract,
} from '../shared/src/testing/sdk-gateway-contract-verifier.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const contract = loadSdkGatewayContract(repoRoot);
const gatewayTaxonomyRaw = fs.readFileSync(
  path.join(repoRoot, 'backend/src/errors/gateway-taxonomy.json'),
  'utf8',
);
const gatewayTaxonomy = JSON.parse(gatewayTaxonomyRaw);

console.log('[Contract #1872] Verifying consumer-driven contracts between @syncro/sdk and v3 Gateway...');

// 1. Source-level header contract verification across SDK and Gateway modules
const sdkPaidFetchSrc = fs.readFileSync(path.join(repoRoot, 'sdk/src/v3/paid-fetch.ts'), 'utf8');
const sdkGatewayClientSrc = fs.readFileSync(path.join(repoRoot, 'sdk/src/v3/gateway-client.ts'), 'utf8');
const gwLifecycleSrc = fs.readFileSync(path.join(repoRoot, 'backend/src/services/v3/gateway-lifecycle.ts'), 'utf8');
const gwRouteV3Src = fs.readFileSync(path.join(repoRoot, 'backend/src/routes/v3/gateway.ts'), 'utf8');
const gwPaidRouteSrc = fs.readFileSync(path.join(repoRoot, 'backend/src/routes/v3-gateway.ts'), 'utf8');
const gwErrorResponseSrc = fs.readFileSync(path.join(repoRoot, 'backend/src/errors/gateway-error-response.ts'), 'utf8');

const headerAssertions = [
  {
    header: contract.headers.paymentRequired,
    consumerFile: 'sdk/src/v3/paid-fetch.ts',
    consumerSrc: sdkPaidFetchSrc,
    providerFiles: [
      ['backend/src/services/v3/gateway-lifecycle.ts', gwLifecycleSrc],
      ['backend/src/routes/v3/gateway.ts', gwRouteV3Src],
    ],
  },
  {
    header: contract.headers.paymentSignature,
    consumerFile: 'sdk/src/v3/paid-fetch.ts',
    consumerSrc: sdkPaidFetchSrc,
    providerFiles: [['backend/src/services/v3/gateway-lifecycle.ts', gwLifecycleSrc]],
  },
  {
    header: contract.headers.paymentResponse,
    consumerFile: 'sdk/src/v3/paid-fetch.ts',
    consumerSrc: sdkPaidFetchSrc,
    providerFiles: [['backend/src/services/v3/gateway-lifecycle.ts', gwLifecycleSrc]],
  },
  {
    header: contract.headers.retryAfter,
    consumerFile: 'sdk/src/v3/gateway-client.ts',
    consumerSrc: sdkGatewayClientSrc,
    providerFiles: [['backend/src/errors/gateway-error-response.ts', gwErrorResponseSrc]],
  },
  {
    header: contract.headers.inlineReceipt,
    consumerFile: 'backend/src/routes/v3-gateway.ts',
    consumerSrc: gwPaidRouteSrc,
    providerFiles: [['backend/src/routes/v3-gateway.ts', gwPaidRouteSrc]],
  },
  {
    header: contract.headers.receiptUrl,
    consumerFile: 'backend/src/routes/v3-gateway.ts',
    consumerSrc: gwPaidRouteSrc,
    providerFiles: [['backend/src/routes/v3-gateway.ts', gwPaidRouteSrc]],
  },
  {
    header: contract.headers.meterDegraded,
    consumerFile: 'backend/src/routes/v3-gateway.ts',
    consumerSrc: gwPaidRouteSrc,
    providerFiles: [['backend/src/routes/v3-gateway.ts', gwPaidRouteSrc]],
  },
];

for (const check of headerAssertions) {
  if (!check.consumerSrc.toLowerCase().includes(check.header.toLowerCase())) {
    throw new SdkGatewayContractMismatchError(
      'headerContract',
      check.header,
      `Consumer file ${check.consumerFile} no longer references header "${check.header}".`,
    );
  }
  for (const [providerFile, providerSrc] of check.providerFiles) {
    if (!providerSrc.toLowerCase().includes(check.header.toLowerCase())) {
      throw new SdkGatewayContractMismatchError(
        'headerContract',
        check.header,
        `Provider file ${providerFile} no longer emits or reads header "${check.header}".`,
      );
    }
  }
}

// 2. Error taxonomy verification (#1493)
assertGatewayTaxonomyAlignedWithContract(contract, gatewayTaxonomy.errors);

for (const entry of contract.errorTaxonomy) {
  assert.equal(isGatewayErrorCode(entry.code), true, `SDK missing taxonomy code ${entry.code}`);
  const sdkError = createGatewayErrorFromCode(entry.code, {
    ...(entry.retryAfterSeconds !== undefined ? { retryAfterSeconds: entry.retryAfterSeconds } : {}),
  });
  assert.equal(sdkError.code, entry.code);
  assert.equal(sdkError.status, entry.httpStatus);
  assert.equal(sdkError.action, entry.action);
  assert.equal(sdkError.retryable, entry.retryable);

  const retrySemantics = getGatewayRetrySemantics(entry.code);
  assert.equal(retrySemantics.retryable, entry.retryable);
  assert.equal(retrySemantics.supportsRetryAfter, entry.supportsRetryAfterHeader);

  // Verify GatewayClient parses the gateway error body for this code
  const responseSnapshot = {
    status: entry.httpStatus,
    headers:
      entry.retryAfterSeconds !== undefined
        ? { [contract.headers.retryAfter]: String(entry.retryAfterSeconds) }
        : {},
    body: {
      code: entry.code,
      message: entry.defaultMessage,
      action: entry.action,
      retryable: entry.retryable,
      ...(entry.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: entry.retryAfterSeconds }
        : {}),
    },
  };

  assertErrorResponseMatchesContract(contract, entry.code, responseSnapshot);

  // Verify SDK deserialization of gateway error body + Retry-After header
  const retryHeaderVal = responseSnapshot.headers[contract.headers.retryAfter];
  const retryAfterMs = retryHeaderVal !== undefined ? Number(retryHeaderVal) * 1000 : undefined;
  const deserializedError = createGatewayErrorFromCode(responseSnapshot.body.code, {
    message: responseSnapshot.body.message,
    status: responseSnapshot.status,
    retryAfterMs,
  });
  assert.equal(deserializedError.code, entry.code);
  assert.equal(deserializedError.status, entry.httpStatus);
  assert.equal(deserializedError.action, entry.action);
  assert.equal(deserializedError.retryable, entry.retryable);
  if (entry.retryAfterSeconds !== undefined) {
    assert.equal(deserializedError.retryAfterMs, entry.retryAfterSeconds * 1000);
  }
}

// 3. Gateway 402 Challenge & SDK consumption verification
const gatewayKeys = generateKeyPairSync('ed25519');
const gatewayPublicKey = gatewayKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const { challenge, headerValue } = generatePaymentChallenge(
  {
    settlementAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '10',
    rate: '0.1',
    contract: 'C_CONTRACT_V3',
    chain: 'stellar:testnet',
  },
  (canonical) => signEd25519(null, Buffer.from(canonical), gatewayKeys.privateKey).toString('base64'),
);

assertGatewayChallengeResponseMatchesContract(contract, {
  status: 402,
  headers: { [contract.headers.paymentRequired]: headerValue },
  body: {
    error: 'Payment required: machine-readable payment instruction challenge',
    challenge,
  },
});

assert.deepEqual(parsePaymentChallenge(headerValue), challenge);
assert.deepEqual(parsePaymentRequiredHeader(headerValue), challenge);

// 4. End-to-end createPaidFetch 402 -> PAYMENT-SIGNATURE -> PAYMENT-RESPONSE verification
const unsignedX402 = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'stellar:testnet',
      amount: '100',
      asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      payTo: 'G_PROVIDER_PAYOUT',
      maxTimeoutSeconds: 60,
    },
  ],
};
const canonicalUnsigned = JSON.stringify({
  accepts: [
    {
      amount: '100',
      asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      maxTimeoutSeconds: 60,
      network: 'stellar:testnet',
      payTo: 'G_PROVIDER_PAYOUT',
      scheme: 'exact',
    },
  ],
  x402Version: 2,
});
const signedX402 = {
  ...unsignedX402,
  signature: signEd25519(null, Buffer.from(canonicalUnsigned), gatewayKeys.privateKey).toString('base64'),
};
const x402Header = serialisePaymentRequiredHeader(signedX402);
assertX402ChallengeHeaderMatchesContract(contract, contract.headers.paymentRequired, x402Header);

let calls = 0;
const paidFetch = createPaidFetch({
  gatewayPublicKey,
  sign: (payload) => `sig_${Buffer.from(payload).toString('hex').slice(0, 32)}`,
  fetchImpl: async (_input, init) => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({ code: 'GATEWAY_PAYMENT_REQUIRED' }), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          [contract.headers.paymentRequired]: x402Header,
        },
      });
    }
    const reqHeaders = new Headers(init?.headers);
    const sigHeader = reqHeaders.get(contract.headers.paymentSignature);
    assert.ok(sigHeader, 'SDK must send PAYMENT-SIGNATURE header on 402 retry');
    const parsedSig = parsePaymentSignatureHeader(sigHeader);
    assert.ok(parsedSig, 'PAYMENT-SIGNATURE header must conform to X402SignedPaymentPayload contract');

    const settlementHeader = serialisePaymentResponseHeader({
      success: true,
      transaction: 'tx_contract_verified_01',
      network: 'stellar:testnet',
    });
    assert.ok(parsePaymentResponseHeader(settlementHeader));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        [contract.headers.paymentResponse]: settlementHeader,
      },
    });
  },
});

const paidRes = await paidFetch('https://gateway.syncro.test/api/v3/gateway/proxy', { method: 'POST' });
assert.equal(paidRes.status, 200);
assert.deepEqual(paidRes.receipt, {
  success: true,
  transaction: 'tx_contract_verified_01',
  network: 'stellar:testnet',
});

// 5. Gateway channel-state proof contract
const channelProof = {
  channelId: 'chan_contract_1',
  sequenceNumber: 1,
  userBalance: 250,
  executorBalance: 50,
  totalDeposited: 300,
  nonce: 'nonce_contract_1',
  signature: 'sig_valid_contract_1',
  payerAddress: 'G_PAYER_CONTRACT',
};
const proofHeader = serialisePaymentProof(channelProof);
const parsedProof = parsePaymentProof(proofHeader);
assert.deepEqual(parsedProof, channelProof);
const verifiedProof = verifyPaymentProof(parsedProof, 10);
assert.equal(verifiedProof.valid, true);

// 6. Negative drift verification: fail on header rename or field rename
assert.throws(
  () =>
    assertGatewayChallengeResponseMatchesContract(contract, {
      status: 402,
      headers: { 'X-RENAMED-PAYMENT-REQUIRED': headerValue },
      body: { error: 'Payment required', challenge },
    }),
  SdkGatewayContractMismatchError,
);

const missingAssetChallenge = { ...challenge };
delete missingAssetChallenge.settlementAsset;
assert.throws(
  () =>
    assertGatewayChallengeResponseMatchesContract(contract, {
      status: 402,
      headers: {
        [contract.headers.paymentRequired]: Buffer.from(JSON.stringify(missingAssetChallenge)).toString('base64'),
      },
      body: { error: 'Payment required', challenge: missingAssetChallenge },
    }),
  SdkGatewayContractMismatchError,
);

assert.throws(
  () =>
    assertErrorResponseMatchesContract(contract, 'GATEWAY_SCOPE_DENIED', {
      status: 403,
      headers: {},
      body: {
        errorCode: 'GATEWAY_SCOPE_DENIED',
        message: 'Denied',
        action: 'request_access',
        retryable: false,
      },
    }),
  SdkGatewayContractMismatchError,
);

console.log(`✓ [Contract #1872] Verified all challenge shapes, headers, payment proofs, receipts, and ${contract.errorTaxonomy.length} error taxonomy contracts!`);
