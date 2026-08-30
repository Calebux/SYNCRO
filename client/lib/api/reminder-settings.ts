import { apiGet, apiPatch } from "@/lib/api"

export interface ReminderSettings {
  user_id: string
  reminder_days_before: number[]
  created_at: string
  updated_at: string
}

export interface ReminderSettingsUpdateInput {
  reminder_days_before?: number[]
}

export const fetchReminderSettings = async (): Promise<ReminderSettings> => {
  const response = await apiGet('/api/reminder-settings')
  return response.data
}

export const updateReminderSettings = async (updates: ReminderSettingsUpdateInput): Promise<ReminderSettings> => {
  const response = await apiPatch('/api/reminder-settings', updates)
  return response.data
}