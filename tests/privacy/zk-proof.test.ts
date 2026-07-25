import { describe, it, expect } from 'vitest';
import {
  commit,
  verify,
} from '../../shared/src/crypto/pedersen';
import {
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '../../shared/src/crypto/payment-commitment';

describe('Privacy Integration: ZK Proof Flow', () => {
  it('should create a Pedersen commitment that hides the payment amount', () => {
    const amount = 1599n; // $15.99 in cents
    const { commitment, blindingFactor } = commit(amount);

    expect(commitment).toBeDefined();
    expect(typeof commitment).toBe('string');
    expect(commitment).not.toContain('1599');
    expect(blindingFactor).toBeDefined();
  });

  it('should verify a valid commitment on-chain', () => {
    const amount = 1599n;
    const { commitment, blindingFactor } = commit(amount);
    const isValid = verify(amount, BigInt('0x' + blindingFactor), commitment);
    expect(isValid).toBe(true);
  });

  it('should reject verification with wrong amount (no data leaked)', () => {
    const amount = 1599n;
    const { commitment, blindingFactor } = commit(amount);
    const isValid = verify(999n, BigInt('0x' + blindingFactor), commitment);
    expect(isValid).toBe(false);
  });

  it('should produce different commitments for same amount (hiding property)', () => {
    const amount = 1599n;
    const commitment1 = commit(amount);
    const commitment2 = commit(amount);
    expect(commitment1.commitment).not.toBe(commitment2.commitment);
    expect(commitment1.blindingFactor).not.toBe(commitment2.blindingFactor);
  });

  it('should create and verify a payment commitment with metadata', () => {
    const amount = 5499n;
    const metadata = 'subscription:adobe_cc:yearly';
    const paymentCommitment = createPaymentCommitment(amount, metadata);

    expect(paymentCommitment.amountCommitment).toBeDefined();
    expect(paymentCommitment.amountBlindingFactor).toBeDefined();
    expect(paymentCommitment.metadata).toBeDefined();
    expect(paymentCommitment.metadata).not.toContain('adobe');

    const isValid = verifyPaymentCommitment(amount, paymentCommitment);
    expect(isValid).toBe(true);
  });

  it('should simulate full ZK proof flow: pay → prove → verify → no leak', () => {
    const subscriptionPayments = [
      { amount: 1599n, desc: 'Netflix' },
      { amount: 999n, desc: 'Spotify' },
      { amount: 5499n, desc: 'Adobe CC' },
    ];

    const commitments = subscriptionPayments.map(({ amount, desc }) => ({
      ...createPaymentCommitment(amount, desc),
      originalAmount: amount,
    }));

    for (const c of commitments) {
      const isValid = verifyPaymentCommitment(c.originalAmount, c);
      expect(isValid).toBe(true);
    }

    for (const c of commitments) {
      const wrongAmount = c.originalAmount + 1n;
      const isValid = verifyPaymentCommitment(wrongAmount, c);
      expect(isValid).toBe(false);
    }

    const commitmentStrings = commitments.map((c) => c.amountCommitment);
    const uniqueCommitments = new Set(commitmentStrings);
    expect(uniqueCommitments.size).toBe(commitments.length);
  });
});
