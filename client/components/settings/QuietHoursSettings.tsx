"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Loader2, Moon, Sun, Bell, BellOff, Clock, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { 
  fetchUserPreferences, 
  updateQuietHours, 
  testQuietHours,
  fetchDelayedNotifications,
  type UserPreferences,
  type QuietHoursTestResult,
  type DelayedNotification
} from "@/lib/api/user-preferences"
import { formatDateTime } from "@/lib/timezone-utils"
import { useUserSettings } from "@/components/providers/user-settings-provider"

// Common timezones for the dropdown
const COMMON_TIMEZONES = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
]

export default function QuietHoursSettings() {
  const { settings } = useUserSettings()
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<QuietHoursTestResult | null>(null)
  const [delayedNotifications, setDelayedNotifications] = useState<DelayedNotification[]>([])
  const [showDelayed, setShowDelayed] = useState(false)

  // Form state
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false)
  const [startTime, setStartTime] = useState('22:00')
  const [endTime, setEndTime] = useState('08:00')
  const [timezone, setTimezone] = useState('UTC')
  const [criticalAlertsOnly, setCriticalAlertsOnly] = useState(true)

  useEffect(() => {
    loadPreferences()
  }, [])

  const loadPreferences = async () => {
    try {
      const prefs = await fetchUserPreferences()
      setPreferences(prefs)
      setQuietHoursEnabled(prefs.quiet_hours_enabled)
      setStartTime(prefs.quiet_hours_start)
      setEndTime(prefs.quiet_hours_end)
      setTimezone(prefs.quiet_hours_timezone)
      setCriticalAlertsOnly(prefs.critical_alerts_only)
    } catch (error) {
      console.error('Failed to load preferences:', error)
      toast.error('Failed to load quiet hours settings')
    } finally {
      setLoading(false)
    }
  }

  const loadDelayedNotifications = async () => {
    try {
      const notifications = await fetchDelayedNotifications('pending')
      setDelayedNotifications(notifications)
    } catch (error) {
      console.error('Failed to load delayed notifications:', error)
      toast.error('Failed to load delayed notifications')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await updateQuietHours({
        quiet_hours_enabled: quietHoursEnabled,
        quiet_hours_start: startTime,
        quiet_hours_end: endTime,
        quiet_hours_timezone: timezone,
        critical_alerts_only: criticalAlertsOnly,
      })
      
      // Update local state
      if (preferences) {
        setPreferences({
          ...preferences,
          ...updated,
        })
      }
      
      toast.success('Quiet hours settings saved successfully')
    } catch (error) {
      console.error('Failed to save quiet hours settings:', error)
      toast.error('Failed to save quiet hours settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const result = await testQuietHours()
      setTestResult(result)
      toast.success('Quiet hours test completed')
    } catch (error) {
      console.error('Failed to test quiet hours:', error)
      toast.error('Failed to test quiet hours configuration')
    } finally {
      setTesting(false)
    }
  }

  const toggleDelayedNotifications = async () => {
    if (!showDelayed) {
      await loadDelayedNotifications()
    }
    setShowDelayed(!showDelayed)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Moon className="h-5 w-5" />
            Quiet Hours Settings
          </CardTitle>
          <CardDescription>
            Set time periods when only critical alerts will be sent immediately. 
            Non-critical notifications will be delayed until your quiet hours end.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="quiet-hours-enabled" className="text-base font-medium">
                Enable Quiet Hours
              </Label>
              <p className="text-sm text-muted-foreground">
                Activate do-not-disturb mode during specified hours
              </p>
            </div>
            <Switch
              id="quiet-hours-enabled"
              checked={quietHoursEnabled}
              onCheckedChange={setQuietHoursEnabled}
            />
          </div>

          {quietHoursEnabled && (
            <>
              {/* Time Range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start-time">Start Time</Label>
                  <Input
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-time">End Time</Label>
                  <Input
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Timezone */}
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Critical Alerts Only */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="critical-only" className="text-base font-medium">
                    Critical Alerts Only
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Only allow critical alerts during quiet hours (recommended)
                  </p>
                </div>
                <Switch
                  id="critical-only"
                  checked={criticalAlertsOnly}
                  onCheckedChange={setCriticalAlertsOnly}
                />
              </div>

              {/* Info Alert */}
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Critical alerts</strong> include: final day renewal reminders, 
                  trial expiring today, and urgent account notifications. 
                  Non-critical alerts will be delayed until {endTime} in your timezone.
                </AlertDescription>
              </Alert>
            </>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Settings
            </Button>
            
            {quietHoursEnabled && (
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Clock className="mr-2 h-4 w-4" />
                Test Configuration
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      {testResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sun className="h-5 w-5" />
              Test Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <strong>Current Status:</strong>
                <Badge variant={testResult.isCurrentlyQuietHours ? "secondary" : "default"} className="ml-2">
                  {testResult.isCurrentlyQuietHours ? "Quiet Hours Active" : "Normal Hours"}
                </Badge>
              </div>
              <div>
                <strong>Test Time:</strong> {formatDateTime(testResult.testTime)}
              </div>

              <div>
                <strong>Your Timezone:</strong> {testResult.userTimezone}
              </div>
              <div>
                <strong>Quiet Hours:</strong> {testResult.quietHoursStart} - {testResult.quietHoursEnd}
              </div>
              {testResult.quietHoursEndTime && (
                <div className="col-span-2">
                  <strong>Delayed notifications will be sent at:</strong> {formatDateTime(testResult.quietHoursEndTime)}
                </div>
              )}

            </div>
          </CardContent>
        </Card>
      )}

      {/* Delayed Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellOff className="h-5 w-5" />
              Delayed Notifications
            </div>
            <Button variant="outline" size="sm" onClick={toggleDelayedNotifications}>
              {showDelayed ? 'Hide' : 'Show'} Pending ({delayedNotifications.length})
            </Button>
          </CardTitle>
          <CardDescription>
            Notifications that are currently delayed due to your quiet hours settings
          </CardDescription>
        </CardHeader>
        {showDelayed && (
          <CardContent>
            {delayedNotifications.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No delayed notifications
              </p>
            ) : (
              <div className="space-y-3">
                {delayedNotifications.map((notification) => (
                  <div key={notification.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">
                        {notification.notification_payload?.title || 'Notification'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {notification.notification_payload?.body || 'No description'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Scheduled for: {formatDateTime(notification.scheduled_send_time)}
                      </p>

                    </div>
                    <Badge variant="outline">
                      {notification.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}