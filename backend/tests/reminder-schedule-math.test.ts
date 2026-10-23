import { reminderDateBefore, MONTH_END_ANCHORS, LEAP_DAY_ANCHORS, DST_BOUNDARY_INSTANTS } from '@syncro/shared/subscription-math';
import { computeReminderDate } from '../src/services/reminder-engine';

describe('reminder scheduler shares subscription-math properties', () => {
  it('matches reminderDateBefore on month-end, leap-day, and DST generators', () => {
    const anchors = [...MONTH_END_ANCHORS, ...LEAP_DAY_ANCHORS, ...DST_BOUNDARY_INSTANTS];
    for (const iso of anchors) {
      const renewal = new Date(iso);
      for (const days of [0, 1, 3, 7, 14]) {
        expect(computeReminderDate(renewal, days).getTime()).toBe(reminderDateBefore(renewal, days).getTime());
      }
    }
  });

  it('reminders stay strictly before renewal and strictly increasing as daysBefore shrinks', () => {
    const renewal = new Date('2026-03-08T06:30:00.000Z');
    const d14 = computeReminderDate(renewal, 14);
    const d7 = computeReminderDate(renewal, 7);
    const d1 = computeReminderDate(renewal, 1);
    expect(d14.getTime()).toBeLessThan(d7.getTime());
    expect(d7.getTime()).toBeLessThan(d1.getTime());
    expect(d1.getTime()).toBeLessThan(renewal.getTime());
  });
});
