/**
 * CSV export utilities for subscription data.
 *
 * Builds on the sanitisation helpers in csv-utils.ts and adds
 * subscription-specific column definitions, filtering, and date-range
 * support.
 */

import { generateSafeCSV, downloadCSV } from "./csv-utils"

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
  const d = new Date(Date.now() + sub.renewsIn * 24 * 60 * 60 * 1000)
  return d.toLocaleDateString()
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
    sub.date_added ? new Date(sub.date_added).toLocaleDateString() : "",
    sub.last_renewed ? new Date(sub.last_renewed).toLocaleDateString() : "",
  ]
}

/** Export all subscriptions in the current view. */
export function exportAllCSV(subscriptions: any[]): void {
  const csv = generateSafeCSV(HEADERS, subscriptions.map(toRow))
  downloadCSV(csv, "syncro-subscriptions")
}

/** Export only subscriptions whose status is "active". */
export function exportActiveCSV(subscriptions: any[]): void {
  const active = subscriptions.filter((s) => s.status === "active")
  const csv = generateSafeCSV(HEADERS, active.map(toRow))
  downloadCSV(csv, "syncro-active-subscriptions")
}

/**
 * Export subscriptions whose next renewal falls within [from, to].
 * `from` and `to` are plain Date objects (time component ignored).
 */
export function exportDateRangeCSV(
  subscriptions: any[],
  from: Date,
  to: Date,
): void {
  const fromMs = from.setHours(0, 0, 0, 0)
  const toMs = to.setHours(23, 59, 59, 999)

  const inRange = subscriptions.filter((s) => {
    if (s.renewsIn == null) return false
    const renewal = Date.now() + s.renewsIn * 24 * 60 * 60 * 1000
    return renewal >= fromMs && renewal <= toMs
  })

  const label =
    `syncro-renewals-${from.toISOString().split("T")[0]}` +
    `-to-${to.toISOString().split("T")[0]}`

  const csv = generateSafeCSV(HEADERS, inRange.map(toRow))
  downloadCSV(csv, label)
}
