import { describe, expect, it } from 'vitest';
import { formatBalance } from '../../../packages/ui/src/lib/numeric-formatting';

describe('formatBalance precision', () => {
  it('preserves very large base-unit balances', () => {
    expect(formatBalance(BigInt('123456789012345678901'), {
      code: 'XLM',
      symbol: 'XLM',
      decimals: 7,
      stroopsPerXlm: 10_000_000,
    })).toBe('12,345,678,901,234.5678901 XLM');
  });
});
