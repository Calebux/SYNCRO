import { getSupabaseBrowserClient } from "./browser-client"
import { apiPatch, apiPost } from "@/lib/api"

export interface NotificationPreferences {
  subscription_id: string
  reminder_days_before: number[]
  channels: ("email" | "push" | "telegram" | "slack")[]
  muted: boolean
  muted_until: string | null
  custom_message: string | null
  created_at: string
  updated_at: string
}

export interface NotificationPreferencesUpdateInput {
  reminder_days_before?: number[]
  channels?: NotificationPreferences["channels"]
  muted?: boolean
  muted_until?: string | null
  custom_message?: string | null
}

/**
 * Fetch notification preferences directly from Supabase.
 * Matches the same pattern as fetchSubscriptions() in subscriptions.ts.
 * Returns null if no override has been set yet for this subscription.
 */
export async function fetchNotificationPreferences(
  subscriptionId: string,
): Promise<NotificationPreferences | null> {
  const supabase = getSupabaseBrowserClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    console.log("[notif-prefs] No authenticated user found")
    return null
  }

  const { data, error } = await supabase
    .from("subscription_notification_preferences")
    .select("*")
    .eq("subscription_id", subscriptionId)
    .single()

  if (error) {
    // PGRST116 = no rows returned — not an error, just no override set yet
    if (error.code === "PGRST116") return null
    console.error("[notif-prefs] Error fetching preferences:", error)
    throw error
  }

  return data as NotificationPreferences
}

/**
 * Update notification preferences via the backend API.
 * Uses apiPatch from lib/api.ts — hits PATCH /api/subscriptions/:id/notification-preferences
 * so Zod validation and allowlist enforcement runs server-side.
 */
export async function updateNotificationPreferences(
  subscriptionId: string,
  input: NotificationPreferencesUpdateInput,
): Promise<NotificationPreferences> {
  const res = await apiPatch(
    `/api/subscriptions/${subscriptionId}/notification-preferences`,
    input,
  )
  return res.data as NotificationPreferences
}

/**
 * Snooze all reminders for a subscription until a given date.
 * Uses apiPost from lib/api.ts — hits POST /api/subscriptions/:id/snooze
 * so future-date validation runs server-side.
 */
export async function snoozeSubscription(
  subscriptionId: string,
  until: string,
): Promise<NotificationPreferences> {
  const res = await apiPost(
    `/api/subscriptions/${subscriptionId}/snooze`,
    { until },
  )
  return res.data as NotificationPreferences
}

/**
 * Unmute a subscription — clears both muted flag and muted_until.
 * Convenience wrapper around updateNotificationPreferences.
 */
export async function unmuteSubscription(
  subscriptionId: string,
): Promise<NotificationPreferences> {
  return updateNotificationPreferences(subscriptionId, {
    muted: false,
    muted_until: null,
  })
}
