jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/lib/scan-cursor-store', () => ({
  getScanCursor: jest.fn().mockResolvedValue(null),
  setScanCursor: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/secret-provider', () => ({
  secretProvider: { getSecret: jest.fn() },
}));

import { StealthScanner } from '../src/services/stealth-scanner';
import { supabase } from '../src/config/database';
import { setScanCursor } from '../src/lib/scan-cursor-store';
import { secretProvider } from '../src/services/secret-provider';
import {
  deriveEphemeralStealthAddress,
  detectStealthDestination,
} from '@syncro/shared/crypto';

describe('StealthScanner', () => {
  let scanner: StealthScanner;
  let viewPriv: string;
  let viewPub: string;
  let spendPub: string;

  beforeAll(async () => {
    const { secp256k1 } = await import('@noble/curves/secp256k1');
    viewPriv = '0101010101010101010101010101010101010101010101010101010101010101';
    const spendPriv = '0202020202020202020202020202020202020202020202020202020202020202';
    const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    viewPub = toHex(secp256k1.getPublicKey(viewPriv, true));
    spendPub = toHex(secp256k1.getPublicKey(spendPriv, true));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    scanner = new StealthScanner();
    process.env.STEALTH_VIEW_PRIVKEY = viewPriv;
    process.env.STEALTH_SPEND_PUBKEY = spendPub;
  });

  it('detects stealth payment from memo_return and destination', () => {
    const derived = deriveEphemeralStealthAddress(
      { viewPublicKey: viewPub, spendPublicKey: spendPub },
      'sub-1:approval-1',
    );
    const memo = Buffer.from(derived.ephemeralPubkey, 'hex').subarray(1).toString('base64');

    const tx = {
      id: 'tx-1',
      hash: 'hash-abc',
      ledger: 12345,
      created_at: new Date().toISOString(),
      paging_token: 'cursor-1',
      memo_type: 'return',
      memo_return: memo,
      _embedded: {
        operations: [
          {
            type: 'payment',
            destination: derived.stealthAddress,
            amount: '9.99',
            asset_type: 'native',
          },
        ],
      },
    };

    const result = scanner.scanTransactionForStealth(tx, {
      viewPrivateKey: viewPriv,
      spendPublicKey: spendPub,
    });

    expect(result).not.toBeNull();
    expect(result!.stealthAddress).toBe(derived.stealthAddress);
    expect(result!.amount).toBe(9.99);
  });

  it('detectStealthDestination matches sender derivation', () => {
    const derived = deriveEphemeralStealthAddress(
      { viewPublicKey: viewPub, spendPublicKey: spendPub },
      'cycle-42',
    );
    const detected = detectStealthDestination(viewPriv, spendPub, derived.ephemeralPubkey);
    expect(detected).toBe(derived.stealthAddress);
  });

  it('stores stealth payment and ignores duplicates', async () => {
    const insert = jest
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate' } });

    (supabase.from as jest.Mock).mockReturnValue({ insert });

    const record = {
      stealthAddress: 'addr',
      ephemeralPubkey: 'ephemeral',
      amount: 5,
      createdAt: new Date().toISOString(),
      transactionHash: 'hash-1',
    };

    expect(await scanner.storeStealthPayment(record, 'user-1')).toBe(true);
    expect(await scanner.storeStealthPayment(record, 'user-1')).toBe(false);
  });

  it('scanLedgerForUser persists cursor after scan', async () => {
    (secretProvider.getSecret as jest.Mock).mockResolvedValue(viewPriv);

    const derived = deriveEphemeralStealthAddress(
      { viewPublicKey: viewPub, spendPublicKey: spendPub },
      'cycle-1',
    );
    const memo = Buffer.from(derived.ephemeralPubkey, 'hex').subarray(1).toString('base64');

    const mockTx = {
      id: 'tx-3',
      hash: 'hash-ghi',
      ledger: 99,
      created_at: new Date().toISOString(),
      paging_token: 'cursor-99',
      memo_type: 'return',
      memo_return: memo,
      _embedded: {
        operations: [{ type: 'payment', destination: derived.stealthAddress, amount: '1.0' }],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _embedded: { records: [mockTx] } }),
    }) as any;

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'stealth_payments') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null }),
      };
    });

    const result = await scanner.scanLedgerForUser('user-1');

    expect(result.scanned).toBe(1);
    expect(result.detected).toBe(1);
    expect(setScanCursor).toHaveBeenCalledWith('user-1', 'cursor-99');
  });
});
