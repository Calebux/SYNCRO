/**
 * Payment Provider Contract — Type and State Machine Tests
 *
 * This test suite verifies:
 * 1. All required PaymentProvider interface methods exist at the type level
 * 2. State machine transition validation works correctly
 * 3. State metadata helpers return expected values
 *
 * Note: This does NOT test actual provider implementations (Stripe, PayPal, Paystack).
 * Those will be tested via a shared conformance suite in Phase 2.
 *
 * Related: Issue #1282 — Payment provider abstraction
 */

import {
  PaymentState,
  PaymentStateTransition,
  isValidTransition,
  isTerminalState,
  isSuccessfulState,
  isRefundableState,
  getStateMetadata,
  type PaymentTransition,
  type PaymentEvent,
} from '../src/types/payment-state';

import {
  PaymentProvider,
  PaymentProviderError,
  type CreateIntentParams,
  type CreateIntentResult,
  type CaptureParams,
  type CaptureResult,
  type RefundParams,
  type RefundResult,
  type PaymentStatusResult,
  type WebhookVerification,
  type PaymentAmount,
} from '../src/types/payment-provider';

describe('Payment State Machine', () => {
  describe('isValidTransition', () => {
    it('allows pending -> authorized', () => {
      expect(isValidTransition('pending', 'authorized')).toBe(true);
    });

    it('allows pending -> failed', () => {
      expect(isValidTransition('pending', 'failed')).toBe(true);
    });

    it('allows authorized -> captured', () => {
      expect(isValidTransition('authorized', 'captured')).toBe(true);
    });

    it('allows authorized -> failed', () => {
      expect(isValidTransition('authorized', 'failed')).toBe(true);
    });

    it('allows captured -> settled', () => {
      expect(isValidTransition('captured', 'settled')).toBe(true);
    });

    it('allows captured -> failed', () => {
      expect(isValidTransition('captured', 'failed')).toBe(true);
    });

    it('allows captured -> refunded', () => {
      expect(isValidTransition('captured', 'refunded')).toBe(true);
    });

    it('allows settled -> refunded', () => {
      expect(isValidTransition('settled', 'refunded')).toBe(true);
    });

    it('disallows pending -> captured', () => {
      expect(isValidTransition('pending', 'captured')).toBe(false);
    });

    it('disallows authorized -> settled', () => {
      expect(isValidTransition('authorized', 'settled')).toBe(false);
    });

    it('disallows failed -> anything (terminal)', () => {
      expect(isValidTransition('failed', 'pending')).toBe(false);
      expect(isValidTransition('failed', 'authorized')).toBe(false);
      expect(isValidTransition('failed', 'captured')).toBe(false);
    });

    it('disallows refunded -> anything (terminal)', () => {
      expect(isValidTransition('refunded', 'pending')).toBe(false);
      expect(isValidTransition('refunded', 'captured')).toBe(false);
    });
  });

  describe('isTerminalState', () => {
    it('identifies failed as terminal', () => {
      expect(isTerminalState('failed')).toBe(true);
    });

    it('identifies refunded as terminal', () => {
      expect(isTerminalState('refunded')).toBe(true);
    });

    it('does not identify pending as terminal', () => {
      expect(isTerminalState('pending')).toBe(false);
    });

    it('does not identify authorized as terminal', () => {
      expect(isTerminalState('authorized')).toBe(false);
    });

    it('does not identify captured as terminal', () => {
      expect(isTerminalState('captured')).toBe(false);
    });

    it('does not identify settled as terminal', () => {
      expect(isTerminalState('settled')).toBe(false);
    });
  });

  describe('isSuccessfulState', () => {
    it('identifies captured as successful', () => {
      expect(isSuccessfulState('captured')).toBe(true);
    });

    it('identifies settled as successful', () => {
      expect(isSuccessfulState('settled')).toBe(true);
    });

    it('does not identify pending as successful', () => {
      expect(isSuccessfulState('pending')).toBe(false);
    });

    it('does not identify authorized as successful', () => {
      expect(isSuccessfulState('authorized')).toBe(false);
    });

    it('does not identify failed as successful', () => {
      expect(isSuccessfulState('failed')).toBe(false);
    });

    it('does not identify refunded as successful', () => {
      expect(isSuccessfulState('refunded')).toBe(false);
    });
  });

  describe('isRefundableState', () => {
    it('identifies captured as refundable', () => {
      expect(isRefundableState('captured')).toBe(true);
    });

    it('identifies settled as refundable', () => {
      expect(isRefundableState('settled')).toBe(true);
    });

    it('does not identify pending as refundable', () => {
      expect(isRefundableState('pending')).toBe(false);
    });

    it('does not identify authorized as refundable', () => {
      expect(isRefundableState('authorized')).toBe(false);
    });

    it('does not identify failed as refundable', () => {
      expect(isRefundableState('failed')).toBe(false);
    });

    it('does not identify refunded as refundable', () => {
      expect(isRefundableState('refunded')).toBe(false);
    });
  });

  describe('getStateMetadata', () => {
    it('returns correct metadata for pending', () => {
      const meta = getStateMetadata('pending');
      expect(meta.state).toBe('pending');
      expect(meta.terminal).toBe(false);
      expect(meta.successful).toBe(false);
      expect(meta.refundable).toBe(false);
      expect(meta.description).toContain('awaiting');
    });

    it('returns correct metadata for authorized', () => {
      const meta = getStateMetadata('authorized');
      expect(meta.state).toBe('authorized');
      expect(meta.terminal).toBe(false);
      expect(meta.successful).toBe(false);
      expect(meta.refundable).toBe(false);
      expect(meta.description).toContain('reserved');
    });

    it('returns correct metadata for captured', () => {
      const meta = getStateMetadata('captured');
      expect(meta.state).toBe('captured');
      expect(meta.terminal).toBe(false);
      expect(meta.successful).toBe(true);
      expect(meta.refundable).toBe(true);
      expect(meta.description).toContain('transit');
    });

    it('returns correct metadata for settled', () => {
      const meta = getStateMetadata('settled');
      expect(meta.state).toBe('settled');
      expect(meta.terminal).toBe(false); // Can still transition to refunded
      expect(meta.successful).toBe(true);
      expect(meta.refundable).toBe(true);
      expect(meta.description).toContain('transferred');
    });

    it('returns correct metadata for failed', () => {
      const meta = getStateMetadata('failed');
      expect(meta.state).toBe('failed');
      expect(meta.terminal).toBe(true);
      expect(meta.successful).toBe(false);
      expect(meta.refundable).toBe(false);
    });

    it('returns correct metadata for refunded', () => {
      const meta = getStateMetadata('refunded');
      expect(meta.state).toBe('refunded');
      expect(meta.terminal).toBe(true);
      expect(meta.successful).toBe(false);
      expect(meta.refundable).toBe(false);
    });
  });
});

describe('PaymentProvider Interface', () => {
  /**
   * Mock implementation to verify interface compliance.
   * This is a minimal mock that satisfies TypeScript's type checker,
   * ensuring all required methods and types are defined correctly.
   */
  class MockPaymentProvider implements PaymentProvider {
    readonly name = 'mock';

    async createIntent(_params: CreateIntentParams): Promise<CreateIntentResult> {
      return {
        intentId: 'mock_intent_123',
        state: 'pending',
        clientActionUrl: null,
      };
    }

    async capture(_intentId: string, _params?: CaptureParams): Promise<CaptureResult> {
      return {
        transactionId: 'mock_txn_123',
        state: 'captured',
        capturedAmount: { value: 1000, currency: 'USD' },
        capturedAt: new Date().toISOString(),
      };
    }

    async refund(_transactionId: string, _params: RefundParams): Promise<RefundResult> {
      return {
        refundId: 'mock_refund_123',
        state: 'refunded',
        refundedAmount: { value: 1000, currency: 'USD' },
        refundedAt: new Date().toISOString(),
        expectedSettlement: null,
      };
    }

    async getStatus(_paymentId: string): Promise<PaymentStatusResult> {
      return {
        paymentId: 'mock_intent_123',
        state: 'captured',
        amount: { value: 1000, currency: 'USD' },
        transitions: [],
        lastUpdatedAt: new Date().toISOString(),
      };
    }

    async verifyWebhook(
      _rawPayload: Buffer | string,
      _headers: Record<string, string | string[] | undefined>
    ): Promise<WebhookVerification> {
      return {
        valid: true,
        event: {
          eventType: 'capture_completed',
          paymentId: 'mock_intent_123',
          state: 'captured',
          occurredAt: new Date().toISOString(),
          providerEventType: 'mock.capture.completed',
          provider: 'mock',
        },
      };
    }

    parseWebhookEvent(_providerEvent: unknown): PaymentEvent | null {
      return {
        eventType: 'capture_completed',
        paymentId: 'mock_intent_123',
        state: 'captured',
        occurredAt: new Date().toISOString(),
        providerEventType: 'mock.capture.completed',
        provider: 'mock',
      };
    }
  }

  it('accepts a valid PaymentProvider implementation', () => {
    const provider: PaymentProvider = new MockPaymentProvider();
    expect(provider.name).toBe('mock');
  });

  it('createIntent returns expected structure', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.createIntent({
      amount: { value: 1000, currency: 'USD' },
      idempotencyKey: 'test_key',
    });

    expect(result).toHaveProperty('intentId');
    expect(result).toHaveProperty('state');
    expect(result).toHaveProperty('clientActionUrl');
    expect(result.state).toBe('pending');
  });

  it('capture returns expected structure', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.capture('mock_intent_123');

    expect(result).toHaveProperty('transactionId');
    expect(result).toHaveProperty('state');
    expect(result).toHaveProperty('capturedAmount');
    expect(result).toHaveProperty('capturedAt');
    expect(result.capturedAmount).toHaveProperty('value');
    expect(result.capturedAmount).toHaveProperty('currency');
  });

  it('refund returns expected structure', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.refund('mock_txn_123', {
      idempotencyKey: 'refund_key',
    });

    expect(result).toHaveProperty('refundId');
    expect(result).toHaveProperty('state');
    expect(result).toHaveProperty('refundedAmount');
    expect(result).toHaveProperty('refundedAt');
    expect(result).toHaveProperty('expectedSettlement');
  });

  it('getStatus returns expected structure', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.getStatus('mock_intent_123');

    expect(result).toHaveProperty('paymentId');
    expect(result).toHaveProperty('state');
    expect(result).toHaveProperty('amount');
    expect(result).toHaveProperty('transitions');
    expect(result).toHaveProperty('lastUpdatedAt');
    expect(Array.isArray(result.transitions)).toBe(true);
  });

  it('verifyWebhook returns expected structure', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.verifyWebhook(Buffer.from('test'), {
      'x-signature': 'test',
    });

    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('event');
    if (result.event) {
      expect(result.event).toHaveProperty('eventType');
      expect(result.event).toHaveProperty('paymentId');
      expect(result.event).toHaveProperty('occurredAt');
      expect(result.event).toHaveProperty('providerEventType');
      expect(result.event).toHaveProperty('provider');
    }
  });

  it('parseWebhookEvent returns expected structure', () => {
    const provider = new MockPaymentProvider();
    const event = provider.parseWebhookEvent({ type: 'test' });

    if (event) {
      expect(event).toHaveProperty('eventType');
      expect(event).toHaveProperty('paymentId');
      expect(event).toHaveProperty('occurredAt');
      expect(event).toHaveProperty('providerEventType');
      expect(event).toHaveProperty('provider');
    }
  });
});

describe('PaymentProviderError', () => {
  it('creates error with required properties', () => {
    const error = new PaymentProviderError('Test error', 'stripe', 'test_code', true);

    expect(error.message).toBe('Test error');
    expect(error.provider).toBe('stripe');
    expect(error.code).toBe('test_code');
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('PaymentProviderError');
  });

  it('creates error without optional properties', () => {
    const error = new PaymentProviderError('Test error', 'paypal');

    expect(error.message).toBe('Test error');
    expect(error.provider).toBe('paypal');
    expect(error.code).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  it('can wrap a cause error', () => {
    const cause = new Error('Network timeout');
    const error = new PaymentProviderError('Payment failed', 'paystack', 'timeout', true, cause);

    expect(error.cause).toBe(cause);
  });

  it('has a stack trace', () => {
    const error = new PaymentProviderError('Test error', 'stripe');
    expect(error.stack).toBeDefined();
  });
});

describe('Payment Type Structures', () => {
  it('PaymentAmount has required fields', () => {
    const amount: PaymentAmount = {
      value: 1000,
      currency: 'USD',
    };

    expect(amount.value).toBe(1000);
    expect(amount.currency).toBe('USD');
  });

  it('PaymentTransition has required fields', () => {
    const transition: PaymentTransition = {
      fromState: 'pending',
      toState: 'authorized',
      transitionedAt: '2024-01-01T00:00:00Z',
      reason: 'user_completed_3ds',
    };

    expect(transition.fromState).toBe('pending');
    expect(transition.toState).toBe('authorized');
    expect(transition.transitionedAt).toBe('2024-01-01T00:00:00Z');
    expect(transition.reason).toBe('user_completed_3ds');
  });

  it('CreateIntentParams has required fields', () => {
    const params: CreateIntentParams = {
      amount: { value: 5000, currency: 'NGN' },
      idempotencyKey: 'key_123',
      metadata: { userId: 'user_456' },
      returnUrl: 'https://example.com/return',
    };

    expect(params.amount.value).toBe(5000);
    expect(params.idempotencyKey).toBe('key_123');
    expect(params.returnUrl).toBe('https://example.com/return');
  });
});
