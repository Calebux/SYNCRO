import { supabase, databaseRepository, databaseRepository } from "../config/database";
import type { MonthlyDigestSummary } from "../types/digest";
import { uniqueIds } from "../utils/db-query-metrics";

interface UserRow {
  id: string;
  email: string | null;
}

interface ProfileRow {
  id: string;
  currency: string | null;
}

interface SubscriptionRow {
  user_id: string;
  price: number | null;
}

interface Period {
  periodMonth: number;
  periodYear: number;
  periodLabel: string;
}

function currentPeriod(now = new Date()): Period {
  return {
    periodMonth: now.getMonth() + 1,
    periodYear: now.getFullYear(),
    periodLabel: now.toLocaleString("default", {
      month: "long",
      year: "numeric",
    }),
  };
}

function composeSummary(
  userId: string,
  userEmail: string,
  displayCurrency: string,
  totalMonthlySpend: number,
  period: Period,
): MonthlyDigestSummary {
  return {
    userId,
    userEmail,

    generatedAt: new Date().toISOString(),

    periodMonth: period.periodMonth,
    periodYear: period.periodYear,
    periodLabel: period.periodLabel,

    totalMonthlySpend,

    lastMonthSpend: 0,

    spendDifference: totalMonthlySpend - 0,

    spendDifferencePercent: 0,

    upcomingRenewals: [],
    renewalsCount: 0,

    priceChanges: [],
    alerts: [],

    yearToDateSpend: totalMonthlySpend,

    currency: displayCurrency,
  };
}

/**
 * Build monthly digest summaries for many users using a fixed number of
 * queries (issue #1095).
 *
 * The per-user builder needed three round-trips each (users, profiles,
 * subscriptions), so composing a digest run for N users cost 3N queries. This
 * batches all three lookups with `.in(...)` filters and fans the rows back out
 * in memory, so the cost is three queries no matter how many users are passed.
 *
 * Callers are expected to page their user lists (see
 * `DigestService.runMonthlyDigest`) so the `.in(...)` filters stay a sane size.
 */
export async function buildMonthlySummaries(
  userIds: readonly string[],
): Promise<Map<string, MonthlyDigestSummary>> {
  const summaries = new Map<string, MonthlyDigestSummary>();
  const ids = uniqueIds(userIds);
  if (ids.length === 0) return summaries;

  const period = currentPeriod();

  // Three batched round-trips, issued in parallel.
  const [usersRes, profilesRes, subsRes] = await Promise.all([
    databaseRepository.from("users").select("id, email").in("id", ids),
    databaseRepository.from("profiles").select("id, currency").in("id", ids),
    databaseRepository.from("subscriptions").select("user_id, price").in("user_id", ids),
  ]);

  const emailByUser = new Map<string, string>();
  for (const row of (usersRes.data ?? []) as UserRow[]) {
    emailByUser.set(row.id, row.email ?? "");
  }

  const currencyByUser = new Map<string, string>();
  for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
    currencyByUser.set(row.id, row.currency || "USD");
  }

  const spendByUser = new Map<string, number>();
  for (const row of (subsRes.data ?? []) as SubscriptionRow[]) {
    if (!row.user_id) continue;
    spendByUser.set(row.user_id, (spendByUser.get(row.user_id) ?? 0) + (row.price ?? 0));
  }

  for (const userId of ids) {
    summaries.set(
      userId,
      composeSummary(
        userId,
        emailByUser.get(userId) ?? "",
        currencyByUser.get(userId) ?? "USD",
        spendByUser.get(userId) ?? 0,
        period,
      ),
    );
  }

  return summaries;
}

export async function buildMonthlySummary(
  userId: string,
): Promise<MonthlyDigestSummary> {
  const summaries = await buildMonthlySummaries([userId]);
  return (
    summaries.get(userId) ??
    composeSummary(userId, "", "USD", 0, currentPeriod())
  );
}
