import { apiGet, apiPatch } from "@/lib/api"

export interface UserPreferences {
  user_id: string
  notification_channels: ('email' | 'push' | 'telegram' | 'slack')[]
  reminder_timing: number[]
  email_opt_ins: {
    marketing: boolean
    reminders: boolean
    updates: boolean
  }
  automation_flags: {
    auto_renew: boolean
    auto_retry: boolean
  }
  risk_notification_threshold?: 'LOW' | 'MEDIUM' | 'HIGH'
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_timezone: string
  critical_alerts_only: boolean
  currency: string
  timezone: string
  locale: string
  preferred_gift_card_provider: string
  privacy_mode_enabled: boolean
  encryption_key?: string
  subscription_priority_order?: string[]
  updated_at: string
}

export interface UserPreferencesUpdateInput {
  notification_channels?: ('email' | 'push' | 'telegram' | 'slack')[]
  reminder_timing?: number[]
  email_opt_ins?: {
    marketing?: boolean
    reminders?: boolean
    updates?: boolean
  }
  automation_flags?: {
    auto_renew?: boolean
    auto_retry?: boolean
  }
  risk_notification_threshold?: 'LOW' | 'MEDIUM' | 'HIGH'
  quiet_hours_enabled?: boolean
  quiet_hours_start?: string
  quiet_hours_end?: string
  quiet_hours_timezone?: string
  critical_alerts_only?: boolean
  currency?: string
  timezone?: string
  locale?: string
  preferred_gift_card_provider?: string
  privacy_mode_enabled?: boolean
  encryption_key?: string
  subscription_priority_order?: string[]
}

export interface QuietHoursUpdateInput {
  quiet_hours_enabled: boolean
  quiet_hours_start?: string
  quiet_hours_end?: string
  quiet_hours_timezone?: string
  critical_alerts_only?: boolean
}

export interface DelayedNotification {
  id: string
  user_id: string
  reminder_schedule_id: string
  notification_payload: any
  original_send_time: string
  scheduled_send_time: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  status: 'pending' | 'sent' | 'cancelled'
  delay_reason: string | null
  created_at: string
  updated_at: string
}

export interface QuietHoursTestResult {
  testTime: string
  userTimezone: string
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  isCurrentlyQuietHours: boolean
  isAppropriateTimeForDelayed: boolean
  quietHoursEndTime: string | null
  criticalAlertsOnly: boolean
}

/**
 * Fetch user preferences
 */
export async function fetchUserPreferences(): Promise<UserPreferences> {
  const res = await apiGet('/api/user-preferences')
  return res.data as UserPreferences
}

/**
 * Update user preferences (including quiet hours)
 */
export async function updateUserPreferences(
  input: UserPreferencesUpdateInput
): Promise<UserPreferences> {
  const res = await apiPatch('/api/user-preferences', input)
  return res.data as UserPreferences
}

/**
 * Update only quiet hours settings
 */
export async function updateQuietHours(
  input: QuietHoursUpdateInput
): Promise<Partial<UserPreferences>> {
  const res = await apiPatch('/api/user-preferences/quiet-hours', input)
  return res.data as Partial<UserPreferences>
}

/**
 * Get delayed notifications for the current user
 */
export async function fetchDelayedNotifications(
  status?: 'pending' | 'sent' | 'cancelled'
): Promise<DelayedNotification[]> {
  const params = status ? `?status=${status}` : ''
  const res = await apiGet(`/api/user-preferences/delayed-notifications${params}`)
  return res.data as DelayedNotification[]
}

/**
 * Test quiet hours configuration
 */
export async function testQuietHours(testTime?: string): Promise<QuietHoursTestResult> {
  const res = await apiPatch('/api/user-preferences/test-quiet-hours', {
    testTime: testTime || new Date().toISOString()
  })
  return res.data as QuietHoursTestResult
}
