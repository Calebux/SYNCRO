import { formatAmount } from '../logic/format-amount';

describe('formatAmount', () => {
  const xlm = { symbol: 'XLM', decimals: 7 };
  const usdc = { symbol: 'USDC', decimals: 6 };

  it('formats XLM and USDC using their asset precision', () => {
    expect(formatAmount(10_000_000, xlm)).toBe('1.0000000 XLM');
    expect(formatAmount(1_234_567, usdc)).toBe('1.234567 USDC');
  });

  it('formats zero and supports locale-specific separators', () => {
    expect(formatAmount(0, usdc)).toBe('0.000000 USDC');
    expect(formatAmount(1_234_567, usdc, { locale: 'de-DE' })).toBe('1,234567 USDC');
  });

  it('preserves very large integer amounts exactly', () => {
    expect(formatAmount('123456789012345678901234', usdc)).toBe('123,456,789,012,345,678.901234 USDC');
  });

  it('formats negative amounts without losing their sign', () => {
    expect(formatAmount(-1_234_567, usdc)).toBe('-1.234567 USDC');
  });

  it('rejects unsafe numeric base-unit values', () => {
    expect(() => formatAmount(Number.MAX_SAFE_INTEGER + 1, usdc)).toThrow(RangeError);
  });
});
