import { deferQuietHours, nextOccurrence, occurrenceAt } from '../src/services/occurrence-scheduler';

describe('deterministic occurrence scheduler', () => {
  const zones = ['UTC', 'Africa/Lagos', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

  test.each(zones)('preserves a Jan 31 anchor for a year in %s', timezone => {
    const schedule = { anchor: '2024-01-31T12:00:00Z', interval: 'monthly' as const, timezone };
    const dates = Array.from({ length: 13 }, (_, index) => occurrenceAt(schedule, index));
    expect(dates[1].getUTCDate()).toBeGreaterThanOrEqual(28);
    expect(dates[12].getUTCMonth()).toBe(0);
  });

  it('is pure and computes strictly after the supplied now', () => {
    const schedule = { anchor: '2024-02-29T09:00:00Z', interval: 'yearly' as const, timezone: 'UTC' };
    expect(nextOccurrence(schedule, new Date('2025-01-01Z')).toISOString()).toBe('2025-02-28T09:00:00.000Z');
  });

  test.each([
    ['2024-03-10T06:30:00Z', '2024-03-10T12:00:00.000Z'],
    ['2024-11-03T05:30:00Z', '2024-11-03T13:00:00.000Z'],
  ])('defers New York quiet hours across DST: %s', (instant, expected) => {
    const schedule = {
      anchor: instant, interval: 'daily' as const, timezone: 'America/New_York',
      quietHours: { start: '22:00', end: '08:00' },
    };
    expect(deferQuietHours(new Date(instant), schedule).toISOString()).toBe(expected);
  });
});
