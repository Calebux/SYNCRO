import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import QuietHoursSettings from "@/components/settings/QuietHoursSettings"
import CalendarSettings from "@/components/settings/CalendarSettings"
import ReminderSettings from "@/components/settings/ReminderSettings"
import Link from "next/link"

export default async function NotificationSettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <svg aria-hidden="true" className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
        
        <h1 className="text-3xl font-bold tracking-tight">Notification Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your notification preferences, calendar sync, and quiet hours to control when you receive alerts.
        </p>
      </div>

      {/* Navigation Tabs */}
      <nav aria-label="Settings navigation" className="flex space-x-1 mb-8 border-b">
        <Link
          href="/settings/notifications"
          aria-current="page"
          className="px-4 py-2 text-sm font-medium border-b-2 border-blue-500 text-blue-600"
        >
          Quiet Hours
        </Link>
        <Link
          href="/settings/security"
          className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          Security
        </Link>
        <Link
          href="/settings/privacy"
          className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          Privacy
        </Link>
      </nav>

      {/* Reminder Settings */}
      <div className="mb-8">
        <ReminderSettings />
      </div>

      {/* Calendar Sync */}
      <div className="mb-8">
        <CalendarSettings />
      </div>

      {/* Quiet Hours Settings */}
      <QuietHoursSettings />
    </div>
  )
}