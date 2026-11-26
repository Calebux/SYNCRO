import {
  forecastFromPayments,
  isExhaustionWithinWindow,
  parseForecastWindowHours,
  projectExhaustion,
  rollingBurnRatePerDay,
} from '../src/v3/spend-forecast';

const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

describe('spend forecast', () => {
  it('computes a rolling burn rate over the window only', () => {
    const payments = [
      { amount: 7, createdAt: ago(1) },
      { amount: '7', createdAt: ago(24 * 6) },
      { amount: 500, createdAt: ago(24 * 8) }, // outside window
      { amount: 500, createdAt: new Date(NOW + 1000).toISOString() }, // future
      { amount: -5, createdAt: ago(2) },
      { amount: 'x', createdAt: ago(2) },
      { amount: 9, createdAt: 'not-a-date' },
    ];
    expect(rollingBurnRatePerDay(payments, NOW, 7)).toBeCloseTo(2);
    expect(rollingBurnRatePerDay(payments, NOW, 0)).toBe(0);
  });

  it('projects time to exhaustion', () => {
    const f = projectExhaustion(10, 5, NOW);
    expect(f.hoursToExhaustion).toBeCloseTo(48);
    expect(f.projectedExhaustionAt).toBe(new Date(NOW + 48 * 3_600_000).toISOString());
  });

  it('handles no burn and empty headroom', () => {
    expect(projectExhaustion(10, 0, NOW)).toMatchObject({ hoursToExhaustion: null, projectedExhaustionAt: null });
    expect(projectExhaustion(0, 5, NOW).hoursToExhaustion).toBe(0);
    expect(projectExhaustion(0, 0, NOW).hoursToExhaustion).toBe(0);
    expect(projectExhaustion(-3, 5, NOW).hoursToExhaustion).toBe(0);
    expect(projectExhaustion(10, NaN, NOW).hoursToExhaustion).toBeNull();
  });

  it('detects exhaustion inside the alert window', () => {
    const f = forecastFromPayments(1, [{ amount: 7, createdAt: ago(1) }], NOW); // 1/day => 24h
    expect(f.hoursToExhaustion).toBeCloseTo(24);
    expect(isExhaustionWithinWindow(f, 24)).toBe(true);
    expect(isExhaustionWithinWindow(f, 23)).toBe(false);
    expect(isExhaustionWithinWindow({ hoursToExhaustion: null }, 24)).toBe(false);
    expect(isExhaustionWithinWindow({ hoursToExhaustion: 0 }, 24)).toBe(false);
    expect(isExhaustionWithinWindow({ hoursToExhaustion: 0 }, 24, false)).toBe(true);
    expect(isExhaustionWithinWindow({ hoursToExhaustion: 1 }, 0)).toBe(false);
  });

  it('parses the configured window', () => {
    expect(parseForecastWindowHours('48')).toBe(48);
    expect(parseForecastWindowHours(undefined)).toBe(24);
    expect(parseForecastWindowHours('-1')).toBe(24);
  });
});
