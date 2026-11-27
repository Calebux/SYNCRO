import { addDays, addMonths, addWeeks, addYears } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export type ScheduleInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface DeterministicSchedule {
  anchor: string;
  interval: ScheduleInterval;
  intervalCount?: number;
  timezone: string;
  quietHours?: { start: string; end: string };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** Pure occurrence calculation. Monthly anchors clamp to month-end without drift. */
export function occurrenceAt(schedule: DeterministicSchedule, index: number): Date {
  if (!Number.isInteger(index) || index < 0) throw new RangeError('index must be a non-negative integer');
  index *= schedule.intervalCount ?? 1;
  const anchorUtc = new Date(schedule.anchor);
  if (Number.isNaN(anchorUtc.getTime())) throw new RangeError('anchor must be ISO-8601');
  const local = toZonedTime(anchorUtc, schedule.timezone);
  let next: Date;
  if (schedule.interval === 'monthly') {
    const month = local.getMonth() + index;
    const year = local.getFullYear() + Math.floor(month / 12);
    const normalizedMonth = ((month % 12) + 12) % 12;
    next = new Date(local);
    next.setFullYear(year, normalizedMonth, Math.min(local.getDate(), daysInMonth(year, normalizedMonth)));
  } else {
    const add = schedule.interval === 'daily' ? addDays : schedule.interval === 'weekly' ? addWeeks : addYears;
    next = add(local, index);
  }
  return fromZonedTime(next, schedule.timezone);
}

export function nextOccurrence(schedule: DeterministicSchedule, now: Date): Date {
  for (let index = 0; index < 10000; index++) {
    const occurrence = occurrenceAt(schedule, index);
    if (occurrence > now) return deferQuietHours(occurrence, schedule);
  }
  throw new RangeError('schedule horizon exceeded');
}

/** Resolve the quiet-hours end as local wall time on each occurrence (DST-safe). */
export function deferQuietHours(instant: Date, schedule: DeterministicSchedule): Date {
  if (!schedule.quietHours) return instant;
  const local = toZonedTime(instant, schedule.timezone);
  const minutes = local.getHours() * 60 + local.getMinutes();
  const parse = (value: string) => value.split(':').map(Number).reduce((h, m) => h * 60 + m);
  const start = parse(schedule.quietHours.start);
  const end = parse(schedule.quietHours.end);
  const inside = start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inside) return instant;
  if (minutes >= start && start > end) local.setDate(local.getDate() + 1);
  local.setHours(Math.floor(end / 60), end % 60, 0, 0);
  return fromZonedTime(local, schedule.timezone);
}
