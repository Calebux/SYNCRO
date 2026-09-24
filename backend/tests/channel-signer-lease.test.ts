import { ChannelSignerLeaseService } from '../src/services/channel-signer-lease-service';
import { supabase } from '../src/config/database';

/**
 * Basic test for channel signer lease service
 * 
 * This test verifies the 2% implementation:
 * - Lease can be acquired
 * - Nonce allocation is atomic
 * - Concurrent instances are rejected
 */

describe('ChannelSignerLeaseService - Basic Lease Protection', () => {
  let service1: ChannelSignerLeaseService;
  let service2: ChannelSignerLeaseService;
  const testChannelId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    service1 = new ChannelSignerLeaseService();
    service2 = new ChannelSignerLeaseService();

    // Ensure test channel exists in payment_channels
    // In a real scenario, this would be created through the normal flow
    await supabase.from('payment_channels').upsert({
      id: testChannelId,
      user_id: '00000000-0000-0000-0000-000000000002',
      counterparty: 'Test Executor',
      deposit_amount: 1000,
      balance: 1000,
      state: 'active',
    });
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('channel_signer_lease').delete().eq('channel_id', testChannelId);
    await supabase.from('payment_channels').delete().eq('id', testChannelId);
  });

  beforeEach(async () => {
    // Clear any existing lease
    await supabase.from('channel_signer_lease').delete().eq('channel_id', testChannelId);
  });

  test('should acquire lease successfully', async () => {
    const result = await service1.acquireLease(testChannelId);
    
    expect(result.success).toBe(true);
    expect(result.currentNonce).toBe(0);
    expect(result.message).toContain('lease');
  });

  test('should allocate nonces sequentially', async () => {
    await service1.acquireLease(testChannelId);

    const nonce1 = await service1.allocateNonce(testChannelId);
    expect(nonce1.success).toBe(true);
    expect(nonce1.nonce).toBe(1);

    const nonce2 = await service1.allocateNonce(testChannelId);
    expect(nonce2.success).toBe(true);
    expect(nonce2.nonce).toBe(2);
  });

  test('should prevent second instance from acquiring active lease', async () => {
    // Instance 1 acquires lease
    const lease1 = await service1.acquireLease(testChannelId);
    expect(lease1.success).toBe(true);

    // Instance 2 tries to acquire same lease
    const lease2 = await service2.acquireLease(testChannelId);
    expect(lease2.success).toBe(false);
    expect(lease2.message).toContain('another instance');
  });

  test('should prevent nonce allocation without lease', async () => {
    // Try to allocate nonce without acquiring lease first
    const result = await service1.allocateNonce(testChannelId);
    
    expect(result.success).toBe(false);
    expect(result.message).toContain('No lease exists');
  });

  test('should prevent nonce allocation by non-lease-holder', async () => {
    // Instance 1 acquires lease
    await service1.acquireLease(testChannelId);

    // Instance 2 tries to allocate nonce
    const result = await service2.allocateNonce(testChannelId);
    
    expect(result.success).toBe(false);
    expect(result.message).toContain('different instance');
  });

  test('should allow lease takeover after expiry', async () => {
    // Instance 1 acquires a very short lease (1 second)
    await service1.acquireLease(testChannelId, 1);

    // Wait for lease to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Instance 2 should be able to acquire the expired lease
    const lease2 = await service2.acquireLease(testChannelId);
    expect(lease2.success).toBe(true);
    expect(lease2.message).toContain('Expired lease acquired');
  });

  test('should release lease successfully', async () => {
    await service1.acquireLease(testChannelId);
    
    const released = await service1.releaseLease(testChannelId);
    expect(released).toBe(true);

    // After release, instance 2 should be able to acquire
    const lease2 = await service2.acquireLease(testChannelId);
    expect(lease2.success).toBe(true);
  });

  test('holdsLease should return true for active lease holder', async () => {
    await service1.acquireLease(testChannelId);
    
    const holds = await service1.holdsLease(testChannelId);
    expect(holds).toBe(true);
  });

  test('holdsLease should return false for non-lease-holder', async () => {
    await service1.acquireLease(testChannelId);
    
    const holds = await service2.holdsLease(testChannelId);
    expect(holds).toBe(false);
  });

  test('signWithLease should enforce lease protection', async () => {
    let signedWithNonce: number | undefined;

    const result = await service1.signWithLease(testChannelId, async (nonce) => {
      signedWithNonce = nonce;
      return { nonce, signature: 'fake-signature' };
    });

    expect(signedWithNonce).toBe(1);
    expect(result.nonce).toBe(1);
    expect(result.signature).toBe('fake-signature');
  });

  test('signWithLease should fail when lease is held by another instance', async () => {
    // Instance 1 holds the lease
    await service1.acquireLease(testChannelId);

    // Instance 2 tries to sign
    await expect(
      service2.signWithLease(testChannelId, async (nonce) => {
        return { nonce, signature: 'fake-signature' };
      })
    ).rejects.toThrow('another instance');
  });
});
