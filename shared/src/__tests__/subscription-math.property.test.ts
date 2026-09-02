import {
  addInterval,
  occurrencesInRange,
  nextRenewalDate,
  cycleToDays,
  daysToCycle,
  prorateAmount,
  reminderDateBefore,
  zonedCalendarDate,
  MONTH_END_ANCHORS,
  LEAP_DAY_ANCHORS,
  DST_BOUNDARY_INSTANTS,
  type BillingInterval,
} from '../subscription-math';

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randomAnchor(rng: () => number): Date {
  const year = 2020 + Math.floor(rng() * 12);
  const month = Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
}

function randomInterval(rng: () => number): BillingInterval {
  return pick(rng, [
    { unit: 'day' as const, count: 1 + Math.floor(rng() * 14) },
    { unit: 'week' as const, count: 1 + Math.floor(rng() * 4) },
    { unit: 'month' as const, count: 1 },
    { unit: 'month' as const, count: 3 },
    { unit: 'year' as const, count: 1 },
  ]);
}

const ITERATIONS = 120;

describe('subscription-math properties', () => {
  const rng = mulberry32(20260826);

  it('occurrences are strictly increasing', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const anchor = i < MONTH_END_ANCHORS.length
        ? new Date(MONTH_END_ANCHORS[i])
        : i < MONTH_END_ANCHORS.length + LEAP_DAY_ANCHORS.length
          ? new Date(LEAP_DAY_ANCHORS[i - MONTH_END_ANCHORS.length])
          : randomAnchor(rng);
      const interval = randomInterval(rng);
      const start = new Date(anchor.getTime() - 86400000);
      const end = addInterval(addInterval(anchor, interval), interval);
      const dates = occurrencesInRange(anchor, interval, start, end);
      for (let j = 1; j < dates.length; j += 1) {
        expect(dates[j].getTime()).toBeGreaterThan(dates[j - 1].getTime());
      }
    }
  });

  it('a monthly schedule produces exactly 12 occurrences per year', () => {
    const yearStarts = [2024, 2025, 2026, 2027, 2028];
    for (const year of yearStarts) {
      for (const day of [1, 15, 28, 31]) {
        const anchor = new Date(Date.UTC(year, 0, Math.min(day, 31), 12));
        const dates = Array.from({ length: 12 }, (_, step) =>
          addInterval(anchor, { unit: 'month', count: 1 }, step),
        );
        expect(dates).toHaveLength(12);
        for (let j = 1; j < dates.length; j += 1) {
          expect(dates[j].getTime()).toBeGreaterThan(dates[j - 1].getTime());
        }
        const start = new Date(Date.UTC(year, 0, 1, 0));
        const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
        expect(occurrencesInRange(anchor, { unit: 'month', count: 1 }, start, end)).toHaveLength(12);
      }
    }
    for (const leap of LEAP_DAY_ANCHORS) {
      const anchor = new Date(leap);
      const dates = Array.from({ length: 12 }, (_, step) =>
        addInterval(anchor, { unit: 'month', count: 1 }, step),
      );
      expect(dates).toHaveLength(12);
    }
  });

  it('converting a day/week cycle to days and back is lossless', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const interval: BillingInterval = rng() < 0.5
        ? { unit: 'day', count: 1 + Math.floor(rng() * 30) }
        : { unit: 'week', count: 1 + Math.floor(rng() * 8) };
      const days = cycleToDays(interval);
      expect(days).not.toBeNull();
      const roundTrip = daysToCycle(days!);
      if (interval.unit === 'week') {
        expect(roundTrip).toEqual(interval);
      } else if (interval.count % 7 === 0) {
        expect(roundTrip).toEqual({ unit: 'week', count: interval.count / 7 });
      } else {
        expect(roundTrip).toEqual(interval);
      }
    }
  });

  it('proration never exceeds the full amount', () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const full = Math.round(rng() * 50_000) / 100;
      const period = 1 + Math.floor(rng() * 40) * 86400000;
      const elapsed = Math.floor(rng() * period * 3) - period;
      const amount = prorateAmount(full, elapsed, period);
      expect(amount).toBeLessThanOrEqual(full);
      expect(amount).toBeGreaterThanOrEqual(0);
    }
  });

  it('month-end, leap-day, and DST generators stay strictly increasing', () => {
    const cases = [
      ...MONTH_END_ANCHORS.map((iso) => ({ iso, interval: { unit: 'month' as const, count: 1 } })),
      ...LEAP_DAY_ANCHORS.map((iso) => ({ iso, interval: { unit: 'year' as const, count: 1 } })),
      ...DST_BOUNDARY_INSTANTS.map((iso) => ({ iso, interval: { unit: 'day' as const, count: 1 } })),
    ];
    for (const sample of cases) {
      const anchor = new Date(sample.iso);
      let cursor = anchor;
      for (let step = 1; step <= 14; step += 1) {
        const next = addInterval(anchor, sample.interval, step);
        expect(next.getTime()).toBeGreaterThan(cursor.getTime());
        cursor = next;
      }
    }
  });

  it('DST-boundary calendar dates in America/New_York do not skip a day of billing', () => {
    for (const iso of DST_BOUNDARY_INSTANTS) {
      const start = new Date(iso);
      const dates = occurrencesInRange(start, { unit: 'day', count: 1 }, start, addInterval(start, { unit: 'day', count: 3 }));
      const seen = dates.map((d) => zonedCalendarDate(d, 'America/New_York'));
      expect(new Set(seen).size).toBe(seen.length);
      expect(dates).toHaveLength(4);
    }
  });

  it('nextRenewalDate is after the from instant', () => {
    for (let i = 0; i < 40; i += 1) {
      const anchor = randomAnchor(rng);
      const interval = randomInterval(rng);
      const from = addInterval(anchor, interval);
      const next = nextRenewalDate(anchor, interval, from);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});

describe('regression pins', () => {
  it('Jan 31 monthly clamps through February and restores March 31', () => {
    const jan = new Date('2026-01-31T12:00:00.000Z');
    const feb = addInterval(jan, { unit: 'month', count: 1 }, 1);
    const mar = addInterval(jan, { unit: 'month', count: 1 }, 2);
    expect(feb.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(mar.toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(mar.getTime()).toBeGreaterThan(feb.getTime());
  });

  it('leap day plus one year lands on Feb 28', () => {
    const leap = new Date('2024-02-29T12:00:00.000Z');
    expect(addInterval(leap, { unit: 'year', count: 1 }).toISOString().slice(0, 10)).toBe('2025-02-28');
  });
});

describe('reminderDateBefore agrees with occurrence math', () => {
  it('reminder is strictly before renewal for daysBefore > 0', () => {
    for (const iso of [...MONTH_END_ANCHORS, ...LEAP_DAY_ANCHORS, ...DST_BOUNDARY_INSTANTS]) {
      const renewal = new Date(iso);
      const reminder = reminderDateBefore(renewal, 3);
      expect(reminder.getTime()).toBeLessThan(renewal.getTime());
    }
  });
});
