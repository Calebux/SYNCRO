"use client";

/**
 * SubscriptionForecastChart
 *
 * Shows projected subscription costs over the next 3, 6, or 12 months
 * based on current subscriptions and their billing cycles.
 *
 * Features:
 * - Line chart with historical + projected spending
 * - Toggle between 3 / 6 / 12 month forecast windows
 * - Factors in annual vs monthly billing cycles
 * - Highlights upcoming renewals on the timeline
 * - Shows potential savings from suggested cancellations
 * - Responsive design for mobile
 */

import { useState, useMemo } from "react";
import {
  LineChart,
  Card,
  Title,
  Text,
  Bold,
  Flex,
  Badge,
  Tab,
  TabGroup,
  TabList,
} from "@tremor/react";
import { AlertTriangle, TrendingDown, Calendar } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Subscription {
  id: string;
  name: string;
  price: number;
  /** "monthly" | "annual" | "yearly" | "weekly" — anything else treated as monthly */
  billingCycle?: string;
  /** ISO date string of next renewal */
  next_billing_date?: string;
  /** Whether this subscription is flagged as unused / candidate for cancellation */
  is_unused?: boolean;
  category?: string;
  status?: string;
}

interface ForecastDataPoint {
  month: string;
  "Projected Cost": number;
  "Potential Savings": number;
}

interface UpcomingRenewal {
  name: string;
  date: string;
  amount: number;
}

interface SubscriptionForecastChartProps {
  subscriptions?: Subscription[];
  /** Already-paid historical monthly totals, newest-last */
  historicalMonthlyTotals?: number[];
  darkMode?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

/** Monthly cost contribution of a single subscription */
function monthlyEquivalent(sub: Subscription): number {
  const cycle = (sub.billingCycle ?? "monthly").toLowerCase();
  if (cycle === "annual" || cycle === "yearly") return sub.price / 12;
  if (cycle === "weekly") return (sub.price * 52) / 12;
  return sub.price; // monthly (default)
}

/**
 * Returns true if `sub` has a renewal falling within `month` (±15 days
 * tolerance to catch end-of-month edge cases).
 */
function renewsIn(sub: Subscription, month: Date): boolean {
  if (!sub.next_billing_date) return false;
  const renewal = new Date(sub.next_billing_date);
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return renewal >= start && renewal <= end;
}

// ── Main component ────────────────────────────────────────────────────────────

export function SubscriptionForecastChart({
  subscriptions = [],
  historicalMonthlyTotals = [],
  darkMode = false,
}: SubscriptionForecastChartProps) {
  const [windowMonths, setWindowMonths] = useState<3 | 6 | 12>(6);

  const activeSubscriptions = subscriptions.filter(
    (s) => !s.status || s.status === "active" || s.status === "trial"
  );

  const unusedSubscriptions = activeSubscriptions.filter((s) => s.is_unused);

  // Monthly saving if all unused subs were cancelled
  const monthlySavings = useMemo(
    () => unusedSubscriptions.reduce((sum, s) => sum + monthlyEquivalent(s), 0),
    [unusedSubscriptions]
  );

  // Build chart data ─────────────────────────────────────────────────────────
  const chartData: ForecastDataPoint[] = useMemo(() => {
    const points: ForecastDataPoint[] = [];
    const now = new Date();

    // Historical months (up to last 3)
    const histSlice = historicalMonthlyTotals.slice(-3);
    histSlice.forEach((total, i) => {
      const d = addMonths(now, i - histSlice.length);
      points.push({
        month: monthLabel(d),
        "Projected Cost": total,
        "Potential Savings": 0,
      });
    });

    // Future months
    for (let i = 0; i < windowMonths; i++) {
      const d = addMonths(now, i + 1);
      let projected = 0;

      activeSubscriptions.forEach((sub) => {
        const monthly = monthlyEquivalent(sub);
        const cycle = (sub.billingCycle ?? "monthly").toLowerCase();

        if (cycle === "annual" || cycle === "yearly") {
          // Only charge full annual amount in the month the renewal falls
          if (renewsIn(sub, d)) {
            projected += sub.price;
          }
        } else {
          projected += monthly;
        }
      });

      points.push({
        month: monthLabel(d),
        "Projected Cost": parseFloat(projected.toFixed(2)),
        "Potential Savings": parseFloat(monthlySavings.toFixed(2)),
      });
    }

    return points;
  }, [activeSubscriptions, windowMonths, historicalMonthlyTotals, monthlySavings]);

  // Upcoming renewals within the window ─────────────────────────────────────
  const upcomingRenewals: UpcomingRenewal[] = useMemo(() => {
    const now = new Date();
    const cutoff = addMonths(now, windowMonths);
    return activeSubscriptions
      .filter((s) => {
        if (!s.next_billing_date) return false;
        const d = new Date(s.next_billing_date);
        return d >= now && d <= cutoff;
      })
      .map((s) => ({
        name: s.name,
        date: new Date(s.next_billing_date!).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        amount: s.price,
      }))
      .sort(
        (a, b) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
      );
  }, [activeSubscriptions, windowMonths]);

  const valueFormatter = (v: number) => `$${v.toFixed(2)}`;

  const totalProjected = chartData
    .slice(historicalMonthlyTotals.slice(-3).length)
    .reduce((s, p) => s + p["Projected Cost"], 0);

  return (
    <Card className={`p-6 ${darkMode ? "bg-[#2D3748] border-[#374151]" : ""}`}>
      {/* Header */}
      <Flex className="justify-between items-start mb-2 flex-wrap gap-2">
        <div>
          <Title className={darkMode ? "text-white" : ""}>
            Subscription Cost Forecast
          </Title>
          <Text className={`text-sm mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
            Projected spending based on current subscriptions and renewal patterns
          </Text>
        </div>

        {/* Window toggle */}
        <TabGroup
          index={[3, 6, 12].indexOf(windowMonths)}
          onIndexChange={(i) => setWindowMonths(([3, 6, 12] as const)[i])}
        >
          <TabList variant="solid" className="w-fit">
            <Tab>3 mo</Tab>
            <Tab>6 mo</Tab>
            <Tab>12 mo</Tab>
          </TabList>
        </TabGroup>
      </Flex>

      {/* Summary badges */}
      <Flex className="gap-4 mb-6 flex-wrap">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${darkMode ? "bg-[#374151]" : "bg-blue-50"}`}>
          <Calendar className="w-4 h-4 text-blue-500" />
          <Text className="text-sm">
            <Bold>Total projected ({windowMonths}mo):</Bold>{" "}
            <span className="text-blue-600 font-semibold">${totalProjected.toFixed(2)}</span>
          </Text>
        </div>

        {monthlySavings > 0 && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${darkMode ? "bg-[#374151]" : "bg-green-50"}`}>
            <TrendingDown className="w-4 h-4 text-green-500" />
            <Text className="text-sm">
              <Bold>Potential savings:</Bold>{" "}
              <span className="text-green-600 font-semibold">
                ${(monthlySavings * windowMonths).toFixed(2)}
              </span>{" "}
              over {windowMonths} months
            </Text>
          </div>
        )}
      </Flex>

      {/* Chart */}
      <LineChart
        data={chartData}
        index="month"
        categories={["Projected Cost", "Potential Savings"]}
        colors={["blue", "emerald"]}
        valueFormatter={valueFormatter}
        yAxisWidth={70}
        className="h-72"
        showAnimation
        showTooltip
        showLegend
        connectNulls
      />

      {/* Upcoming renewals */}
      {upcomingRenewals.length > 0 && (
        <div className="mt-6">
          <Text className={`text-sm font-semibold mb-3 flex items-center gap-2 ${darkMode ? "text-gray-200" : "text-gray-700"}`}>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Upcoming renewals in the next {windowMonths} months
          </Text>
          <div className="flex flex-wrap gap-2">
            {upcomingRenewals.map((r, i) => (
              <Badge key={i} color="amber" className="text-xs">
                {r.name} — {r.date} (${r.amount.toFixed(2)})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Suggested cancellations */}
      {unusedSubscriptions.length > 0 && (
        <div className={`mt-4 p-4 rounded-lg border ${darkMode ? "border-amber-500/30 bg-amber-500/10" : "border-amber-200 bg-amber-50"}`}>
          <Text className="text-sm font-semibold text-amber-700 mb-2">
            💡 {unusedSubscriptions.length} unused subscription{unusedSubscriptions.length > 1 ? "s" : ""} detected
          </Text>
          <Text className="text-xs text-amber-600">
            Cancelling {unusedSubscriptions.map((s) => s.name).join(", ")} could save you{" "}
            <Bold>${(monthlySavings * windowMonths).toFixed(2)}</Bold> over the next {windowMonths} months.
          </Text>
        </div>
      )}

      <Text className={`mt-4 text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
        * Annual subscriptions are shown in full in their renewal month. Monthly costs use current pricing.
      </Text>
    </Card>
  );
}
