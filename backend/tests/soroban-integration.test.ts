const hasSorobanEnv =
  !!process.env.SOROBAN_RPC_URL &&
  !!process.env.SOROBAN_CONTRACT_ADDRESS &&
  !!process.env.STELLAR_SECRET_KEY;

// This test runs only when Soroban env vars are present.
(hasSorobanEnv ? describe : describe.skip)('Soroban integration', () => {
  it('submits a real transaction for subscription create', async () => {
    const { blockchainService } = await import('../src/services/blockchain-service');
    const userId = 'test-user';
    const subscriptionId = `sub_${Math.random().toString(36).slice(2, 10)}`;
    const result = await blockchainService.syncSubscription(userId, subscriptionId, 'create', {
      name: 'Test Service',
      price: '9.99',
      billing_cycle: 'monthly',
      status: 'active',
    });

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBeDefined();
    expect(typeof result.transactionHash).toBe('string');
    expect(result.transactionHash!.length).toBeGreaterThan(10);
  }, 60000);
});

