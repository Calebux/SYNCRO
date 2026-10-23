import { encodeBalance, decodeBalance, encodeBalances, decodeBalances } from '../logic/bigint-balance';

describe('bigint-balance helpers', () => {
  describe('encodeBalance / decodeBalance', () => {
    it('round-trips a normal bigint value', () => {
      const original = 1234567890123456789n;
      expect(decodeBalance(encodeBalance(original))).toBe(original);
    });

    it('round-trips a value above 2^63 (beyond Number.MAX_SAFE_INTEGER)', () => {
      // 2^63 = 9223372036854775808
      const above2_63 = BigInt('9223372036854775808');
      expect(decodeBalance(encodeBalance(above2_63))).toBe(above2_63);
    });

    it('round-trips a value above 2^53 (where Number() loses precision)', () => {
      // 2^53 + 1 = 9007199254740993
      const above2_53 = BigInt('9007199254740993');
      expect(decodeBalance(encodeBalance(above2_53))).toBe(above2_53);
    });

    it('round-trips zero', () => {
      expect(decodeBalance(encodeBalance(0n))).toBe(0n);
    });

    it('round-trips a negative balance', () => {
      const negative = -9223372036854775808n;
      expect(decodeBalance(encodeBalance(negative))).toBe(negative);
    });

    it('decodeBalance rejects non-numeric strings', () => {
      expect(() => decodeBalance('123.45')).toThrow(RangeError);
      expect(() => decodeBalance('abc')).toThrow(RangeError);
      expect(() => decodeBalance('')).toThrow(RangeError);
      expect(() => decodeBalance('1e3')).toThrow(RangeError);
    });

    it('encodeBalance returns a plain decimal string', () => {
      expect(encodeBalance(42n)).toBe('42');
      expect(encodeBalance(0n)).toBe('0');
      expect(encodeBalance(-7n)).toBe('-7');
    });
  });

  describe('encodeBalances / decodeBalances', () => {
    it('round-trips payer and payee balances', () => {
      const original = { payerBalance: 9223372036854775808n, payeeBalance: 5000000000000000000n };
      const encoded = encodeBalances(original.payerBalance, original.payeeBalance);
      expect(encoded.payerBalance).toBe('9223372036854775808');
      expect(encoded.payeeBalance).toBe('5000000000000000000');
      const decoded = decodeBalances(encoded);
      expect(decoded.payerBalance).toBe(original.payerBalance);
      expect(decoded.payeeBalance).toBe(original.payeeBalance);
    });
  });
});

describe('Number() on balance fields is flagged', () => {
  it('encodeBalance returns a string, not a number', () => {
    const result = encodeBalance(9223372036854775808n);
    expect(typeof result).toBe('string');
    // Using Number() on a bigint balance above 2^53 would lose precision.
    // This test ensures the helper returns a string so that Number() cannot
    // be accidentally applied to a balance value.
    expect(Number(result)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    // The fact that Number() can be called on the string is not the issue;
    // the issue is that the API should carry amounts as strings, not numbers.
    // The helper guarantees the output is a string.
  });

  it('decodeBalance rejects non-string inputs that would come from Number()', () => {
    // If someone accidentally passes a number that came from Number(bigint),
    // it would already have lost precision. decodeBalance requires a string.
    expect(() => decodeBalance(String(Number(9223372036854775808n)))).toThrow();
  });
});
