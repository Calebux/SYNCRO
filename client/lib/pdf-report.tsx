/**
 * PDF report generation for subscription data.
 *
 * Uses @react-pdf/renderer to produce a formatted document with:
 *   - SYNCRO branded header
 *   - Summary (active count, monthly spend, annual spend)
 *   - Subscriptions table grouped by category
 *   - Generated-on timestamp
 *
 * Call `downloadSubscriptionPDF` to trigger a browser download.
 */

import React from "react"
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer"

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1E2A35",
    padding: 36,
    backgroundColor: "#FFFFFF",
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#E86A33",
  },
  brandName: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: "#E86A33",
    letterSpacing: 2,
  },
  reportTitle: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 2,
  },
  generatedDate: {
    fontSize: 9,
    color: "#9CA3AF",
    textAlign: "right",
  },

  // Summary cards
  summaryRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderRadius: 6,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#E86A33",
  },
  summaryLabel: {
    fontSize: 8,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#1E2A35",
  },

  // Category group
  categoryHeader: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#E86A33",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
    marginTop: 16,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },

  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 3,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  tableRowAlt: {
    backgroundColor: "#FAFAFA",
  },

  // Column widths
  colName: { flex: 3 },
  colBilling: { flex: 2 },
  colStatus: { flex: 1.5 },
  colRenewal: { flex: 2 },
  colPrice: { flex: 1.5, textAlign: "right" },

  thText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tdText: {
    fontSize: 9,
    color: "#374151",
  },
  tdBold: {
    fontFamily: "Helvetica-Bold",
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 6,
  },
  footerText: {
    fontSize: 8,
    color: "#9CA3AF",
  },
})

// ─── Types ────────────────────────────────────────────────────────────────

interface ReportSubscription {
  id: number | string
  name: string
  category: string
  price: number
  currency?: string
  billing_cycle?: string
  billingCycle?: string
  status: string
  renewsIn?: number | null
  date_added?: string
}

interface ReportSummary {
  activeCount: number
  monthlyTotal: number
  annualTotal: number
}

interface SubscriptionReportProps {
  subscriptions: ReportSubscription[]
  summary: ReportSummary
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function nextRenewal(sub: ReportSubscription): string {
  if (sub.renewsIn == null) return "—"
  const d = new Date(Date.now() + sub.renewsIn * 24 * 60 * 60 * 1000)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function groupByCategory(
  subscriptions: ReportSubscription[],
): Record<string, ReportSubscription[]> {
  return subscriptions.reduce<Record<string, ReportSubscription[]>>(
    (acc, sub) => {
      const cat = sub.category || "Uncategorized"
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(sub)
      return acc
    },
    {},
  )
}

// ─── Document component ───────────────────────────────────────────────────

const SubscriptionReport: React.FC<SubscriptionReportProps> = ({
  subscriptions,
  summary,
}) => {
  const grouped = groupByCategory(subscriptions)
  const sortedCategories = Object.keys(grouped).sort()
  const generatedOn = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <Document
      title="SYNCRO Subscription Report"
      author="SYNCRO"
      subject="Subscription Report"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandName}>SYNCRO</Text>
            <Text style={styles.reportTitle}>Subscription Report</Text>
          </View>
          <Text style={styles.generatedDate}>Generated {generatedOn}</Text>
        </View>

        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Active Subscriptions</Text>
            <Text style={styles.summaryValue}>{summary.activeCount}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Monthly Spend</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(summary.monthlyTotal)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Annual Spend</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(summary.annualTotal)}
            </Text>
          </View>
        </View>

        {/* Subscriptions by category */}
        {sortedCategories.map((category) => {
          const items = grouped[category]
          return (
            <View key={category} wrap={false}>
              <Text style={styles.categoryHeader}>{category}</Text>

              {/* Table header */}
              <View style={styles.tableHeader}>
                <Text style={[styles.thText, styles.colName]}>Name</Text>
                <Text style={[styles.thText, styles.colBilling]}>
                  Billing Cycle
                </Text>
                <Text style={[styles.thText, styles.colStatus]}>Status</Text>
                <Text style={[styles.thText, styles.colRenewal]}>
                  Next Renewal
                </Text>
                <Text style={[styles.thText, styles.colPrice]}>Price</Text>
              </View>

              {/* Rows */}
              {items.map((sub, idx) => (
                <View
                  key={sub.id}
                  style={[
                    styles.tableRow,
                    idx % 2 === 1 ? styles.tableRowAlt : {},
                  ]}
                >
                  <Text style={[styles.tdText, styles.tdBold, styles.colName]}>
                    {sub.name}
                  </Text>
                  <Text style={[styles.tdText, styles.colBilling]}>
                    {sub.billing_cycle ?? sub.billingCycle ?? "—"}
                  </Text>
                  <Text style={[styles.tdText, styles.colStatus]}>
                    {sub.status}
                  </Text>
                  <Text style={[styles.tdText, styles.colRenewal]}>
                    {nextRenewal(sub)}
                  </Text>
                  <Text style={[styles.tdText, styles.colPrice]}>
                    {formatCurrency(sub.price)}
                  </Text>
                </View>
              ))}
            </View>
          )
        })}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            SYNCRO · Subscription Management
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}

// ─── Download helper ──────────────────────────────────────────────────────

/**
 * Generate and trigger a browser download of the PDF report.
 *
 * @param subscriptions All subscriptions to include in the report.
 */
export async function downloadSubscriptionPDF(
  subscriptions: ReportSubscription[],
): Promise<void> {
  const active = subscriptions.filter((s) => s.status === "active")
  const monthlyTotal = active.reduce((sum, s) => sum + (s.price ?? 0), 0)

  const summary: ReportSummary = {
    activeCount: active.length,
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
  }

  const blob = await pdf(
    <SubscriptionReport subscriptions={subscriptions} summary={summary} />,
  ).toBlob()

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `syncro-report-${new Date().toISOString().split("T")[0]}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
