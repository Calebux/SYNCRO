import { supabase } from "../config/database";
import type { MonthlyDigestSummary } from "../types/digest";

export async function buildMonthlySummary(
  userId: string,
): Promise<MonthlyDigestSummary> {
  const now = new Date();

  const periodMonth = now.getMonth() + 1;
  const periodYear = now.getFullYear();
  const periodLabel = now.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  // get user
  const { data: user } = await supabase
    .from("users")
    .select("email")
    .eq("id", userId)
    .single();

  // get user profile for display currency
  const { data: profile } = await supabase
    .from("profiles")
    .select("currency")
    .eq("id", userId)
    .single();

  const displayCurrency = profile?.currency || "USD";

  // get subscriptions
  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId);

  const totalMonthlySpend =
    subscriptions?.reduce((sum, s) => sum + (s.price ?? 0), 0) ?? 0;

  return {
    userId,
    userEmail: user?.email ?? "",

    generatedAt: new Date().toISOString(),

    periodMonth,
    periodYear,
    periodLabel,

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
