import { getSupabaseBrowserClient } from "./browser-client"

export interface Subscription {
  id: number
  user_id?: string
  name: string
  category: string
  price: number
  icon: string
  renews_in: number | null
  status: string
  color: string
  renewal_url: string | null
  tags: string[]
  date_added: string
  email_account_id: number | null
  last_used_at?: string
  has_api_key?: boolean
  is_trial: boolean
  trial_ends_at?: string
  price_after_trial?: number
  source: string
  manually_edited: boolean
  edited_fields: string[]
  pricing_type: string
  billing_cycle: string
  cancelled_at?: string
  active_until?: string
  paused_at?: string
  resumes_at?: string
  price_range?: { min: number; max: number }
  price_history?: Array<{ date: string; amount: number }>
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    console.log("[v0] No authenticated user found")
    return []
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .order("date_added", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching subscriptions:", error)
    throw error
  }

  return data || []
}

export async function createSubscription(subscription: Omit<Subscription, "id" | "user_id">): Promise<Subscription> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("User must be authenticated to create subscriptions")
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      ...subscription,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Error creating subscription:", error)
    throw error
  }

  return data
}

export async function updateSubscription(id: number, updates: Partial<Subscription>): Promise<Subscription> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("User must be authenticated to update subscriptions")
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single()

  if (error) {
    console.error("[v0] Error updating subscription:", error)
    throw error
  }

  return data
}

export async function deleteSubscription(id: number): Promise<void> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("User must be authenticated to delete subscriptions")
  }

  const { error } = await supabase.from("subscriptions").delete().eq("id", id).eq("user_id", user.id)

  if (error) {
    console.error("[v0] Error deleting subscription:", error)
    throw error
  }
}

export async function bulkDeleteSubscriptions(ids: number[]): Promise<void> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("User must be authenticated to delete subscriptions")
  }

  const { error } = await supabase.from("subscriptions").delete().in("id", ids).eq("user_id", user.id)

  if (error) {
    console.error("[v0] Error bulk deleting subscriptions:", error)
    throw error
  }
}
