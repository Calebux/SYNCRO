import { addWeeks, addMonths, addQuarters, addYears } from 'date-fns';

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'annual';

/**
 * Advance a date by one billing cycle without drifting away from the original day-of-month.
 *
 * The problem with calling addMonths(addMonths(jan31, 1), 1) naively:
 *   Jan 31 → Feb 28 → Mar 28  (drifted — should end at Mar 31)
 *
 * Fix: after advancing months/quarters/years we re-apply the original day clamped
 * to the last valid day of the resulting month.
 */
export function advanceBillingCycle(date: Date, cycle: BillingCycle): Date {
  const originalDay = date.getUTCDate();

  switch (cycle) {
    case 'weekly':
      return addWeeks(date, 1);

    case 'monthly': {
      const next = addMonths(date, 1);
      return clampDay(next, originalDay);
    }

    case 'quarterly': {
      const next = addQuarters(date, 1);
      return clampDay(next, originalDay);
    }

    case 'yearly':
    case 'annual': {
      const next = addYears(date, 1);
      return clampDay(next, originalDay);
    }

    default:
      return date;
  }
}

/** Re-apply `day` to `date`, clamping to the last day of that month if needed. */
function clampDay(date: Date, day: number): Date {
  const result = new Date(date);
  // Last day of the month date-fns already landed on
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
