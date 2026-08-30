"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Calendar, Copy, Check, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  fetchCalendarPreferences,
  updateCalendarPreferences,
  downloadCalendarExport,
  type CalendarPreferences,
} from "@/lib/api/calendar"

export default function CalendarSettings() {
  const [preferences, setPreferences] = useState<CalendarPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [exportReminders, setExportReminders] = useState(true)

  useEffect(() => {
    loadPreferences()
  }, [])

  const loadPreferences = async () => {
    try {
      const data = await fetchCalendarPreferences()
      setPreferences(data)
      setSyncEnabled(data.calendar_sync_enabled)
      setExportReminders(data.calendar_export_reminders)
    } catch (error) {
      console.error("Failed to load calendar preferences:", error)
      toast.error("Failed to load calendar settings")
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await updateCalendarPreferences({
        calendar_sync_enabled: syncEnabled,
        calendar_export_reminders: exportReminders,
      })
      setPreferences(updated)
      toast.success("Calendar settings saved")
    } catch (error) {
      console.error("Failed to update calendar preferences:", error)
      toast.error("Failed to save calendar settings")
    } finally {
      setSaving(false)
    }
  }

  const handleCopyFeedUrl = async () => {
    if (!preferences?.feedUrl) return
    await navigator.clipboard.writeText(preferences.feedUrl)
    setCopied(true)
    toast.success("Calendar feed URL copied")
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      if (!syncEnabled) {
        await updateCalendarPreferences({ calendar_sync_enabled: true })
        setSyncEnabled(true)
      }
      await downloadCalendarExport()
      toast.success("Calendar file downloaded")
    } catch (error) {
      console.error("Failed to export calendar:", error)
      toast.error("Failed to export reminders. Enable calendar sync and try again.")
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Calendar Sync
          </CardTitle>
          <CardDescription>Subscribe to renewal reminders in your calendar app.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Calendar Sync
        </CardTitle>
        <CardDescription>
          Export subscription renewals and reminder schedules to Apple Calendar, Google Calendar, or Outlook.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="calendar-sync-enabled">Enable calendar feed</Label>
            <p className="text-sm text-muted-foreground">
              When enabled, your private iCal feed stays in sync with active subscriptions.
            </p>
          </div>
          <Switch
            id="calendar-sync-enabled"
            checked={syncEnabled}
            onCheckedChange={setSyncEnabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="calendar-export-reminders">Include reminder schedules</Label>
            <p className="text-sm text-muted-foreground">
              Adds pending reminder dates to the calendar export alongside renewal dates.
            </p>
          </div>
          <Switch
            id="calendar-export-reminders"
            checked={exportReminders}
            onCheckedChange={setExportReminders}
            disabled={!syncEnabled}
          />
        </div>

        {syncEnabled && preferences?.feedUrl && (
          <div className="space-y-2">
            <Label>Calendar feed URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={preferences.feedUrl} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={handleCopyFeedUrl}>
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <Alert>
              <AlertDescription>
                Add this URL as a subscribed calendar in your calendar app. Renewals update automatically when
                subscriptions change.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <div className="flex flex-wrap gap-3 justify-end">
          <Button type="button" variant="outline" onClick={handleExport} disabled={exporting || !syncEnabled}>
            {exporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export reminders (.ics)
              </>
            )}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
