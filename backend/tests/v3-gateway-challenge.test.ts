import express from 'express';
import request from 'supertest';
import { createPublicKey, verify } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createV3GatewayRouter } from '../src/routes/v3/gateway';
import { receiptService } from '../src/v3/receipt-runtime';

const originalContract = process.env.SOROBAN_CONTRACT_ADDRESS;
const originalNetwork = process.env.STELLAR_NETWORK;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

function createApp() {
  const app = express();
  app.use('/api/v3/gateway', createV3GatewayRouter());
  return app;
}

afterEach(() => {
  if (originalContract === undefined) delete process.env.SOROBAN_CONTRACT_ADDRESS;
  else process.env.SOROBAN_CONTRACT_ADDRESS = originalContract;
  if (originalNetwork === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = originalNetwork;
});

describe('GET /api/v3/gateway/challenge', () => {
  it('rejects payment parameters supplied in the query string', async () => {
    process.env.SOROBAN_CONTRACT_ADDRESS = 'C_CONFIGURED_CONTRACT';
    const response = await request(createApp())
      .get('/api/v3/gateway/challenge?routeId=inference&asset=attacker&amount=0.01&contract=attacker');

    expect(response.status).toBe(400);
    expect(response.body.challenge).toBeUndefined();
  });

  it('builds a signed challenge from the selected route and configured deployment', async () => {
    process.env.SOROBAN_CONTRACT_ADDRESS = 'C_CONFIGURED_CONTRACT';
    process.env.STELLAR_NETWORK = 'testnet';
    const response = await request(createApp()).get('/api/v3/gateway/challenge?routeId=inference');

    expect(response.status).toBe(402);
    const challenge = response.body.challenge;
    expect(challenge.settlementAsset).toBe(
      'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    expect(challenge.amount).toBe('10');
    expect(challenge.rate).toBe('0.1');
    expect(challenge.contract).toBe('C_CONFIGURED_CONTRACT');
    expect(challenge.chain).toBe('stellar:testnet');
    expect(challenge.signature).toBeTruthy();

    const { signature, ...unsignedChallenge } = challenge;
    const publicKey = receiptService.getReceiptPublicKeys()[0]!.publicKeyPem;
    expect(verify(
      null,
      Buffer.from(canonicalize(unsignedChallenge)),
      createPublicKey(publicKey),
      Buffer.from(signature, 'base64'),
    )).toBe(true);

    const headerChallenge = JSON.parse(Buffer.from(response.headers['payment-required'], 'base64').toString('utf8'));
    expect(headerChallenge).toEqual(challenge);
  });
});
