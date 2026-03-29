import { getSupabaseBrowserClient } from "./browser-client"

export interface CancellationGuide {
  id: string
  service_name: string
  difficulty: "easy" | "medium" | "hard"
  direct_url: string
  steps: string[]
  estimated_time: string
  warning_note?: string
  chat_support_link?: string
  phone_number?: string
  created_at: string
  updated_at: string
}

export interface DifficultyReport {
  service_name: string
  reported_difficulty: "easy" | "medium" | "hard"
  comment?: string
}

export async function fetchCancellationGuide(serviceName: string): Promise<CancellationGuide | null> {
  const supabase = getSupabaseBrowserClient()

  const { data, error } = await supabase
    .from("cancellation_guides")
    .select("*")
    .eq("service_name", serviceName)
    .single()

  if (error) {
    if (error.code === "PGRST116") {
      // No guide found for this service
      return null
    }
    console.error("[v0] Error fetching cancellation guide:", error)
    throw error
  }

  return data
}

export async function fetchAllCancellationGuides(): Promise<CancellationGuide[]> {
  const supabase = getSupabaseBrowserClient()

  const { data, error } = await supabase
    .from("cancellation_guides")
    .select("*")
    .order("service_name", { ascending: true })

  if (error) {
    console.error("[v0] Error fetching all cancellation guides:", error)
    throw error
  }

  return data || []
}

export async function reportDifficulty(report: DifficultyReport): Promise<void> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from("cancellation_difficulty_reports").insert({
    ...report,
    user_id: user?.id,
  })

  if (error) {
    console.error("[v0] Error reporting difficulty:", error)
    throw error
  }
}

export async function markAsCancelled(subscriptionId: number): Promise<void> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("User must be authenticated to update subscriptions")
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId)
    .eq("user_id", user.id)

  if (error) {
    console.error("[v0] Error marking subscription as cancelled:", error)
    throw error
  }
}
