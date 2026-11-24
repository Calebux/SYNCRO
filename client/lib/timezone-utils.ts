export const DEFAULT_TIMEZONE = "UTC"

export interface DateFormatOptions {
  dateStyle?: "full" | "long" | "medium" | "short"
  timeStyle?: "full" | "long" | "medium" | "short"
  locale?: string
  timeZone?: string
}

export function formatDate(
  date: Date | string | number,
  options: DateFormatOptions = {}
): string {
  const dateObj = date instanceof Date ? date : new Date(date)

  if (isNaN(dateObj.getTime())) {
    return "Invalid Date"
  }

  const {
    dateStyle = "medium",
    timeStyle,
    locale = "en-US",
    timeZone = getUserTimezone(),
  } = options

  return new Intl.DateTimeFormat(locale, {
    dateStyle,
    timeStyle,
    timeZone,
  }).format(dateObj)
}

export function formatDateTime(
  date: Date | string | number,
  options: DateFormatOptions = {}
): string {
  return formatDate(date, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  })
}

export function formatDateInUserTimezone(
  date: Date | string | number,
  format: "short" | "long" = "short"
): string {
  if (format === "long") {
    return formatDateTime(date, { dateStyle: "full", timeStyle: "short" })
  }

  return formatDate(date, { dateStyle: "medium" })
}

export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE
  } catch (e) {
    return DEFAULT_TIMEZONE
  }
}

export function addDays(date: Date | string | number, days: number): Date {
  const result = date instanceof Date ? new Date(date) : new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function getDaysDifference(date: Date | string | number, baseDate: Date = new Date()): number {
  const targetDate = date instanceof Date ? date : new Date(date)
  const diff = targetDate.getTime() - baseDate.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function getDaysUntilDate(futureDate: Date): number {
  return getDaysDifference(futureDate)
}
