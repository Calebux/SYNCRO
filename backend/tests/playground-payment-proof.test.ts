import crypto from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  challengeNonceStore,
  channelStateProofMessage,
  defaultChannelStateStore,
  verifyPaymentProof,
  type PaymentProof,
} from '../src/services/v3/payment-challenge-service';

function unsigned(payer: string, nonce: string): Omit<PaymentProof, 'signature'> {
  return {
    channelId: 'chan_playground',
    sequenceNumber: 1,
    userBalance: 100,
    executorBalance: 0,
    totalDeposited: 100,
    nonce,
    payerAddress: payer,
  };
}

describe('testnet agent payment proofs', () => {
  beforeEach(() => {
    challengeNonceStore.clear();
    defaultChannelStateStore.clear();
  });

  it('accepts an Ed25519 signature from the payer public key', () => {
    const payer = Keypair.random();
    const fields = unsigned(payer.publicKey(), 'nonce-stellar');
    const message = channelStateProofMessage(fields);
    const proof: PaymentProof = {
      ...fields,
      signature: Buffer.from(payer.sign(Buffer.from(message, 'utf8'))).toString('base64'),
    };

    expect(verifyPaymentProof(proof, 8)).toEqual({ valid: true });
  });

  it('rejects a signature from a different key and still accepts the dev signatures', () => {
    const payer = Keypair.random();
    const other = Keypair.random();
    const fields = unsigned(payer.publicKey(), 'nonce-wrong-key');
    const proof: PaymentProof = {
      ...fields,
      signature: Buffer.from(other.sign(Buffer.from(channelStateProofMessage(fields), 'utf8'))).toString('base64'),
    };
    expect(verifyPaymentProof(proof, 8).code).toBe('INVALID_SIGNATURE');

    const hmacFields = { ...unsigned('G_PAYER', 'nonce-hmac'), channelId: 'chan_hmac' };
    const hmac = crypto.createHmac('sha256', 'dev-channel-secret').update(channelStateProofMessage(hmacFields)).digest('hex');
    expect(verifyPaymentProof({ ...hmacFields, signature: hmac }, 8).valid).toBe(true);
    expect(verifyPaymentProof({
      ...unsigned('G_PAYER', 'nonce-mock'),
      channelId: 'chan_mock',
      signature: 'mock_valid_signature',
    }, 8).valid).toBe(true);
  });

  it('binds an optional request hash into the signed message', () => {
    const fields = { ...unsigned('G_PAYER', 'nonce-hash'), requestHash: 'abc' };
    expect(channelStateProofMessage(fields)).toBe(
      'chan_playground:1:100:0:nonce-hash:G_PAYER:abc',
    );
  });
});
