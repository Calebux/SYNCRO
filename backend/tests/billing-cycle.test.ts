import { advanceBillingCycle, BillingCycle } from '../src/utils/billing-cycle';

// Helper: build a UTC date cleanly
const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

describe('advanceBillingCycle', () => {
  describe('weekly', () => {
    it('adds exactly 7 days', () => {
      const result = advanceBillingCycle(utc(2024, 1, 1), 'weekly');
      expect(result).toEqual(utc(2024, 1, 8));
    });

    it('no drift: 52 weekly steps return same weekday one year later', () => {
      let d = utc(2024, 1, 1); // Monday
      for (let i = 0; i < 52; i++) d = advanceBillingCycle(d, 'weekly');
      expect(d.getUTCDay()).toBe(utc(2024, 1, 1).getUTCDay());
    });
  });

  describe('monthly — month-end edge cases', () => {
    it('Jan 31 → Feb 29 on a leap year (2024)', () => {
      expect(advanceBillingCycle(utc(2024, 1, 31), 'monthly')).toEqual(utc(2024, 2, 29));
    });

    it('Jan 31 → Feb 28 on a non-leap year (2023)', () => {
      expect(advanceBillingCycle(utc(2023, 1, 31), 'monthly')).toEqual(utc(2023, 2, 28));
    });

    it('Mar 31 → Apr 30', () => {
      expect(advanceBillingCycle(utc(2024, 3, 31), 'monthly')).toEqual(utc(2024, 4, 30));
    });

    it('regular mid-month step does not drift', () => {
      expect(advanceBillingCycle(utc(2024, 1, 15), 'monthly')).toEqual(utc(2024, 2, 15));
    });

    it('no drift: 12 monthly steps from Jan 31 land back on Jan 31', () => {
      let d = utc(2024, 1, 31);
      for (let i = 0; i < 12; i++) d = advanceBillingCycle(d, 'monthly');
      expect(d).toEqual(utc(2025, 1, 31));
    });

    it('no drift: 12 monthly steps from Jan 31 in a year ending at leap Feb', () => {
      // Start Feb 2024 (leap) — 12 steps should land on Feb 2025 (non-leap) → Feb 28
      let d = utc(2024, 2, 29);
      for (let i = 0; i < 12; i++) d = advanceBillingCycle(d, 'monthly');
      // Original day was 29; 2025 Feb has only 28 — clamp
      expect(d).toEqual(utc(2025, 2, 28));
    });
  });

  describe('quarterly', () => {
    it('Mar 31 → Jun 30', () => {
      expect(advanceBillingCycle(utc(2024, 3, 31), 'quarterly')).toEqual(utc(2024, 6, 30));
    });

    it('Nov 30 → Feb 28 on non-leap year', () => {
      expect(advanceBillingCycle(utc(2023, 11, 30), 'quarterly')).toEqual(utc(2024, 2, 29));
    });

    it('regular step Jan 15 → Apr 15', () => {
      expect(advanceBillingCycle(utc(2024, 1, 15), 'quarterly')).toEqual(utc(2024, 4, 15));
    });

    it('no drift: 4 quarterly steps from Jan 31 land back on Jan 31', () => {
      let d = utc(2024, 1, 31);
      for (let i = 0; i < 4; i++) d = advanceBillingCycle(d, 'quarterly');
      expect(d).toEqual(utc(2025, 1, 31));
    });
  });

  describe('yearly / annual', () => {
    it('Jan 1 → Jan 1 next year', () => {
      expect(advanceBillingCycle(utc(2024, 1, 1), 'yearly')).toEqual(utc(2025, 1, 1));
    });

    it('annual alias matches yearly', () => {
      const d = utc(2024, 6, 15);
      expect(advanceBillingCycle(d, 'annual')).toEqual(advanceBillingCycle(d, 'yearly'));
    });

    it('Feb 29 (leap) → Feb 28 the following non-leap year', () => {
      expect(advanceBillingCycle(utc(2024, 2, 29), 'yearly')).toEqual(utc(2025, 2, 28));
    });

    it('Feb 29 (leap) → Feb 29 four years later (next leap year)', () => {
      expect(advanceBillingCycle(utc(2020, 2, 29), 'yearly')).toEqual(utc(2021, 2, 28));
    });
  });

  describe('all cycles — result is always a valid date', () => {
    const cycles: BillingCycle[] = ['weekly', 'monthly', 'quarterly', 'yearly', 'annual'];
    const monthEnds = [
      utc(2024, 1, 31),
      utc(2024, 2, 29),
      utc(2023, 2, 28),
      utc(2024, 3, 31),
      utc(2024, 4, 30),
    ];

    for (const cycle of cycles) {
      for (const date of monthEnds) {
        it(`${cycle} from ${date.toISOString().split('T')[0]} produces a real date`, () => {
          const result = advanceBillingCycle(date, cycle);
          expect(isNaN(result.getTime())).toBe(false);
          expect(result.getTime()).toBeGreaterThan(date.getTime());
        });
      }
    }
  });
});
