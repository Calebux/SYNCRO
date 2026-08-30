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
      { arg0: new Uint8Array(32), arg1: 'GUSER123' },
    );

    expect(tx.contractId).toBe('CCONTRACT123');
    expect(tx.method).toBe('cancel_subscription');
    expect(tx.sourceAccount).toBe('GUSER123');
  });

  it('should build via generic buildContractInvoke', () => {
    const tx = buildContractInvoke('SubscriptionRegistry', 'create_subscription', {
      contractId: 'CCONTRACT123',
      sourceAccount: 'GUSER123',
      args: { arg0: 'GUSER123', arg1: 'Spotify', arg2: 30n, arg3: 999n, arg4: 1n },
    });

    expect(tx.method).toBe('create_subscription');
  });
});
