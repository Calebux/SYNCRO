/**
 * payment-channel-version.test.ts
 *
 * Version-mismatch refusal for channel state signing (ADR-016, issue #1435).
 *
 * Coverage:
 *  - assertContractVersion accepts the expected version
 *  - assertContractVersion rejects unknown / stale / future versions
 *  - applyOffChainRenewal refuses before any DB access on version mismatch
 */

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/env', () => ({
  env: { CHANNEL_SIGNING_SECRET: 'test-channel-signing-secret-32ch' },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { supabase } from '../src/config/database';
import {
  assertContractVersion,
  ContractVersionMismatchError,
  EXPECTED_CHANNEL_CONTRACT_VERSION,
  paymentChannelService,
} from '../src/services/payment-channel-service';

describe('assertContractVersion', () => {
  it('accepts the expected version', () => {
    expect(() =>
      assertContractVersion(EXPECTED_CHANNEL_CONTRACT_VERSION),
    ).not.toThrow();
  });

  it('rejects a stale version with a typed error', () => {
    let caught: unknown;
    try {
      assertContractVersion(EXPECTED_CHANNEL_CONTRACT_VERSION - 1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContractVersionMismatchError);
    expect((caught as ContractVersionMismatchError).code).toBe(
      'CONTRACT_VERSION_MISMATCH',
    );
  });

  it('rejects a future version with a typed error', () => {
    expect(() =>
      assertContractVersion(EXPECTED_CHANNEL_CONTRACT_VERSION + 1),
    ).toThrow(ContractVersionMismatchError);
  });

  it('rejects an unknown version', () => {
    expect(() => assertContractVersion(undefined)).toThrow(
      ContractVersionMismatchError,
    );
  });
});

describe('applyOffChainRenewal version gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to sign when the observed on-chain version mismatches', async () => {
    await expect(
      paymentChannelService.applyOffChainRenewal(
        'ch-1',
        'user-1',
        10,
        {} as never,
        'deadbeef',
        { contractVersion: EXPECTED_CHANNEL_CONTRACT_VERSION + 1 },
      ),
    ).rejects.toMatchObject({ code: 'CONTRACT_VERSION_MISMATCH' });

    // Refusal happens before any channel read or state write.
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
