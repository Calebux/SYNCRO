import { apiGet, apiPatch } from '@/lib/api'

export interface CalendarPreferences {
  calendar_sync_enabled: boolean
  calendar_export_reminders: boolean
  feedUrl: string
}

export interface CalendarPreferencesUpdate {
  calendar_sync_enabled?: boolean
  calendar_export_reminders?: boolean
}

export interface CalendarTokenResponse {
  token: string
  userId: string
  feedUrl: string
}

export async function fetchCalendarPreferences(): Promise<CalendarPreferences> {
  const res = await apiGet('/api/calendar/preferences')
  return res.data as CalendarPreferences
}

export async function updateCalendarPreferences(
  input: CalendarPreferencesUpdate,
): Promise<CalendarPreferences> {
  const res = await apiPatch('/api/calendar/preferences', input)
  return res.data as CalendarPreferences
}

export async function fetchCalendarToken(): Promise<CalendarTokenResponse> {
  const res = await apiGet('/api/calendar/token')
  return {
    token: res.token,
    userId: res.userId,
    feedUrl: res.feedUrl,
  }
}

export function getCalendarFeedUrl(userId: string, token: string): string {
  if (typeof window === 'undefined') {
    return `/api/calendar/feed/${userId}/${token}.ics`
  }
  return `${window.location.protocol}//${window.location.host}/api/calendar/feed/${userId}/${token}.ics`
}

export async function downloadCalendarExport(): Promise<void> {
  const tokenResponse = await fetchCalendarToken()
  const feedUrl = getCalendarFeedUrl(tokenResponse.userId, tokenResponse.token)
  const response = await fetch(feedUrl)
  if (!response.ok) {
    throw new Error('Failed to download calendar export')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'syncro-reminders.ics'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
