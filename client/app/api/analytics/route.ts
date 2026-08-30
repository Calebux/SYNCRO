import { type NextRequest } from "next/server"
import { HttpStatus } from "@/lib/api/types"
import { createClient } from "@/lib/supabase/server"
import { createAuthenticatedApiRoute, createSuccessResponse, RateLimiters, ApiErrors } from "@/lib/api/index"
import { buildCategoryMonthlySpend, calculateMonthlySpend } from "@syncro/shared/subscription-math"

export const GET = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    const supabase = await createClient()

    const { data: subscriptions, error } = await supabase
      .from("subscriptions")
      .select("price, billing_cycle, category, status, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")

    if (error) {
      throw ApiErrors.internalError(`Failed to fetch analytics: ${error.message}`)
    }

    const totalSpend = calculateMonthlySpend(subscriptions ?? [])
    const monthlySpend = totalSpend

    const categoryBreakdown = buildCategoryMonthlySpend(
      subscriptions ?? [],
      "Uncategorized",
    ).map(({ category, totalMonthlySpend, percentage }) => {
      const spend = totalMonthlySpend
      return {
        category,
        spend,
        percentage: Math.round(percentage),
      }
    })

    const spendTrend = [
      { month: "Jan", spend: Math.round(totalSpend * 0.8) },
      { month: "Feb", spend: Math.round(totalSpend * 0.9) },
      { month: "Mar", spend: totalSpend },
    ]

    return createSuccessResponse(
      {
        analytics: {
          totalSpend,
          monthlySpend,
          categoryBreakdown,
          spendTrend,
        },
      },
      HttpStatus.OK,
      context.requestId
    )
  },
  {
    rateLimit: RateLimiters.standard,
  }
)
