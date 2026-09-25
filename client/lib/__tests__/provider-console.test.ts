import { describe, expect, it } from 'vitest';
import {
  describeRateCardVersion,
  previewCallCost,
  settlementStatusLabel,
  type RateCardVersion,
} from '@/lib/provider-console';

function version(overrides: Partial<RateCardVersion> = {}): RateCardVersion {
  return {
    versionId: 'ver-1',
    providerId: 'provider-1',
    routeId: 'route-1',
    sequence: 1,
    label: 'v1',
    price: 2,
    unit: 'request',
    quantityExtractor: 'constant:1',
    pathPattern: '/echo/*',
    method: 'POST',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('previewCallCost', () => {
  it('prices a constant extractor as price times quantity', () => {
    const preview = previewCallCost({ price: 2, quantityExtractor: 'constant:3' });
    expect(preview).toEqual({ ok: true, quantity: 3, unitPrice: 2, cost: 6 });
  });

  it('reads a json extractor from the sample body', () => {
    const preview = previewCallCost({
      price: 0.5,
      quantityExtractor: 'json:usage.tokens',
      sampleBody: JSON.stringify({ usage: { tokens: 4 } }),
    });
    expect(preview).toEqual({ ok: true, quantity: 4, unitPrice: 0.5, cost: 2 });
  });

  it('does not invent a cost for an unknown extractor', () => {
    const preview = previewCallCost({ price: 2, quantityExtractor: 'body.length' });
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.message).toMatch(/constant:<number>/);
    }
  });
});

describe('describeRateCardVersion', () => {
  it('keeps the earlier version in force until the next effective time', () => {
    const first = version();
    const second = version({
      versionId: 'ver-2',
      sequence: 2,
      label: 'v2',
      price: 9,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    const earlier = describeRateCardVersion(first, [first, second]);
    const later = describeRateCardVersion(second, [first, second]);

    expect(earlier).toContain('v1 applies from 2026-01-01T00:00:00.000Z until 2026-06-01T00:00:00.000Z');
    expect(earlier).toContain('Later versions do not replace it.');
    expect(later).toContain('v2 applies from 2026-06-01T00:00:00.000Z');
    expect(later).toContain('Earlier calls are unchanged.');
  });
});

describe('settlementStatusLabel', () => {
  it('names each status on its own', () => {
    expect(settlementStatusLabel('settled')).toBe('Settled');
    expect(settlementStatusLabel('unsettled')).toBe('Unsettled');
    expect(settlementStatusLabel('in_dispute')).toBe('In dispute');
  });
});
