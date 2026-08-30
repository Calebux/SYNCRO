/**
 * CSV export utilities for subscription data.
 *
 * Builds on the sanitisation helpers in csv-utils.ts and adds
 * subscription-specific column definitions, filtering, and date-range
 * support.
 */

import { generateSafeCSV, downloadCSV } from "./csv-utils"
import { formatDate, addDays } from "./timezone-utils"

const HEADERS = [
  "Name",
  "Category",
  "Price",
  "Currency",
  "Billing Cycle",
  "Status",
  "Next Renewal",
  "Added Date",
  "Last Renewed",
]

function nextRenewalDate(sub: any): string {
  if (sub.renewsIn == null) return ""
  return formatDate(addDays(new Date(), sub.renewsIn))
}

function toRow(sub: any): any[] {
  return [
    sub.name ?? "",
    sub.category ?? "",
    sub.price != null ? sub.price.toFixed(2) : "",
    sub.currency ?? "USD",
    sub.billing_cycle ?? sub.billingCycle ?? "",
    sub.status ?? "",
    nextRenewalDate(sub),
    sub.date_added ? formatDate(sub.date_added) : "",
    sub.last_renewed ? formatDate(sub.last_renewed) : "",
  ]
}

/** Export all subscriptions in the current view. */
export function exportAllCSV(subscriptions: any[]): void {
  const csv = generateSafeCSV(HEADERS, subscriptions.map(toRow))
  downloadCSV(csv, "syncro-subscriptions")
}

/** Export only active subscriptions. */
export function exportActiveCSV(subscriptions: any[]): void {
  const active = subscriptions.filter((s) => s.status === "active")
  const csv = generateSafeCSV(HEADERS, active.map(toRow))
  downloadCSV(csv, "syncro-active-subscriptions")
}

/** Export subscriptions added within a specific date range. */
export function exportDateRangeCSV(subscriptions: any[], start: Date, end: Date): void {
  const filtered = subscriptions.filter((s) => {
    if (!s.date_added) return false
    const d = new Date(s.date_added)
    return d >= start && d <= end
  })
  const csv = generateSafeCSV(HEADERS, filtered.map(toRow))
  downloadCSV(csv, `syncro-subscriptions-${start.toISOString().split("T")[0]}`)
}
