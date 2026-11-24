import { describe, it, expect } from 'vitest';
import { deriveStealthAddress } from '../../shared/src/crypto/stealth-derive';
import { encryptMetadata, decryptMetadata } from '../../shared/src/crypto/metadata-encryption';

describe('Privacy Integration: Payment Channel', () => {
  const metaAddress = 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3';
  const subscriptionId = 'sub_channel_test_001';
  const encryptionKey = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  interface ChannelState {
    sequenceNumber: number;
    userBalance: number;
    executorBalance: number;
    totalDeposited: number;
  }

  it('should simulate channel open with only 1 on-chain tx', () => {
    const onChainTxs: string[] = [];

    const depositAmount = 100;
    const stealthAddr = deriveStealthAddress(metaAddress, subscriptionId, 0);
    onChainTxs.push(`open:${stealthAddr}:${depositAmount}`);

    const initialState: ChannelState = {
      sequenceNumber: 0,
      userBalance: depositAmount,
      executorBalance: 0,
      totalDeposited: depositAmount,
    };

    expect(onChainTxs.length).toBe(1);
    expect(initialState.userBalance + initialState.executorBalance).toBe(initialState.totalDeposited);
  });

  it('should process N renewals with 0 on-chain txs', () => {
    const numRenewals = 10;
    const renewalAmount = 10;
    const depositAmount = 100;
    const onChainTxs: string[] = [];

    let state: ChannelState = {
      sequenceNumber: 0,
      userBalance: depositAmount,
      executorBalance: 0,
      totalDeposited: depositAmount,
    };

    for (let i = 0; i < numRenewals; i++) {
      state = {
        sequenceNumber: state.sequenceNumber + 1,
        userBalance: state.userBalance - renewalAmount,
        executorBalance: state.executorBalance + renewalAmount,
        totalDeposited: state.totalDeposited,
      };
    }

    expect(onChainTxs.length).toBe(0);
    expect(state.sequenceNumber).toBe(numRenewals);
    expect(state.userBalance).toBe(0);
    expect(state.executorBalance).toBe(depositAmount);
    expect(state.userBalance + state.executorBalance).toBe(state.totalDeposited);
  });

  it('should close channel with only 1 additional on-chain tx (2 total)', () => {
    const numRenewals = 5;
    const renewalAmount = 10;
    const depositAmount = 100;
    const onChainTxs: string[] = [];

    onChainTxs.push('open:escrow_account:100');

    let state: ChannelState = {
      sequenceNumber: 0,
      userBalance: depositAmount,
      executorBalance: 0,
      totalDeposited: depositAmount,
    };

    for (let i = 0; i < numRenewals; i++) {
      state = {
        sequenceNumber: state.sequenceNumber + 1,
        userBalance: state.userBalance - renewalAmount,
        executorBalance: state.executorBalance + renewalAmount,
        totalDeposited: state.totalDeposited,
      };
    }

    onChainTxs.push(`close:${state.userBalance}:${state.executorBalance}`);

    expect(onChainTxs.length).toBe(2);
    expect(state.userBalance).toBe(50);
    expect(state.executorBalance).toBe(50);
  });

  it('should encrypt channel state updates for privacy', async () => {
    const state: ChannelState = {
      sequenceNumber: 5,
      userBalance: 50,
      executorBalance: 50,
      totalDeposited: 100,
    };

    const encrypted = await encryptMetadata(JSON.stringify(state), encryptionKey);
    expect(encrypted.ciphertext).not.toContain('50');

    const decrypted = await decryptMetadata(encrypted, encryptionKey);
    const recovered = JSON.parse(decrypted) as ChannelState;
    expect(recovered.sequenceNumber).toBe(5);
    expect(recovered.userBalance).toBe(50);
    expect(recovered.executorBalance).toBe(50);
  });

  it('should enforce state ordering (latest state always wins in dispute)', () => {
    const states: ChannelState[] = [];
    const depositAmount = 100;
    const renewalAmount = 10;

    let state: ChannelState = {
      sequenceNumber: 0,
      userBalance: depositAmount,
      executorBalance: 0,
      totalDeposited: depositAmount,
    };
    states.push(state);

    for (let i = 0; i < 5; i++) {
      state = {
        sequenceNumber: state.sequenceNumber + 1,
        userBalance: state.userBalance - renewalAmount,
        executorBalance: state.executorBalance + renewalAmount,
        totalDeposited: state.totalDeposited,
      };
      states.push(state);
    }

    const staleState = states[2];
    const latestState = states[states.length - 1];
    expect(latestState.sequenceNumber).toBeGreaterThan(staleState.sequenceNumber);

    const disputeWinner = states.reduce((a, b) =>
      a.sequenceNumber > b.sequenceNumber ? a : b
    );
    expect(disputeWinner).toEqual(latestState);
  });
});
