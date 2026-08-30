/**
 * Analytics page — server component.
 *
 * Fetches the analytics summary on the server (see ./analytics-data)
 * and passes it into the interactive AnalyticsPage client island.
 *
 * No post-mount fetch is required for first paint.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAnalyticsSummary } from "@/lib/dashboard-analytics";
import { AnalyticsPageContent } from "./analytics-content";

export default async function AnalyticsRoute() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const summary = await getAnalyticsSummary(user.id).catch(() => null);

  return <AnalyticsPageContent initialSummary={summary} />;
}
