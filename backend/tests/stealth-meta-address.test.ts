import {
  decodeStealthMetaAddress,
  encodeStealthMetaAddress,
  generateStealthMetaAddress,
  isValidStealthMetaAddress,
} from '../../shared/src/types/stealth';

describe('stealth meta-address helpers', () => {
  it('round-trips the versioned format', () => {
    const encoded = encodeStealthMetaAddress({
      spendingPubkey: 'spend-123',
      viewingPubkey: 'view-456',
    });

    expect(encoded).toBe('syncro:stealth:v1:spend-123:view-456');
    expect(decodeStealthMetaAddress(encoded)).toEqual({
      version: 'syncro:stealth:v1',
      spendingPubkey: 'spend-123',
      viewingPubkey: 'view-456',
      encoded,
    });
  });

  it('rejects malformed meta-address values', () => {
    expect(isValidStealthMetaAddress('not-a-meta-address')).toBe(false);
    expect(decodeStealthMetaAddress('syncro:stealth:v1:only-one-part')).toBeNull();
  });

  it('generates a valid meta-address with a versioned payload', () => {
    const generated = generateStealthMetaAddress();

    expect(isValidStealthMetaAddress(generated.encoded)).toBe(true);
    expect(generated.version).toBe('syncro:stealth:v1');
    expect(generated.spendingPubkey).toMatch(/^[0-9a-f]{64}$/i);
    expect(generated.viewingPubkey).toMatch(/^[0-9a-f]{64}$/i);
  });
});
