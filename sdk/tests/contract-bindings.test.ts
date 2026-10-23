import {
  buildSubscriptionRegistryCancelSubscription,
  buildContractInvoke,
  type BuiltTransaction,
} from '../src/generated/index.js';

describe('Generated contract bindings', () => {
  it('should build a typed cancel_subscription transaction', () => {
    const tx: BuiltTransaction = buildSubscriptionRegistryCancelSubscription(
      'CCONTRACT123',
      'GUSER123',
      { subscription_id: new Uint8Array(32), caller: 'GUSER123' },
    );

    expect(tx.contractId).toBe('CCONTRACT123');
    expect(tx.method).toBe('cancel_subscription');
    expect(tx.sourceAccount).toBe('GUSER123');
  });

  it('should build via generic buildContractInvoke', () => {
    const tx = buildContractInvoke('SubscriptionRegistry', 'create_subscription', {
      contractId: 'CCONTRACT123',
      sourceAccount: 'GUSER123',
      args: {
        user: 'GUSER123',
        service_id: 'Spotify',
        billing_interval: 30n,
        expected_amount: 999n,
        next_renewal: 1n,
      },
    });

    expect(tx.method).toBe('create_subscription');
  });
});
