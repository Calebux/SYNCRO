"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Plus, X, Clock } from "lucide-react"
import { toast } from "sonner"
import { fetchReminderSettings, updateReminderSettings, type ReminderSettings } from "@/lib/api/reminder-settings"

export default function ReminderSettings() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [daysBefore, setDaysBefore] = useState<number[]>([7, 3, 1])
  const [newDay, setNewDay] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const data = await fetchReminderSettings()
      setSettings(data)
      setDaysBefore(data.reminder_days_before)
    } catch (error) {
      console.error('Failed to load reminder settings:', error)
      toast.error('Failed to load reminder settings')
    } finally {
      setLoading(false)
    }
  }

  const handleAddDay = () => {
    const day = parseInt(newDay)
    if (isNaN(day) || day < 1 || day > 365) {
      toast.error('Please enter a valid number of days (1-365)')
      return
    }
    if (daysBefore.includes(day)) {
      toast.error('This reminder day already exists')
      return
    }
    setDaysBefore([...daysBefore, day].sort((a, b) => b - a)) // Sort descending
    setNewDay('')
  }

  const handleRemoveDay = (day: number) => {
    setDaysBefore(daysBefore.filter(d => d !== day))
  }

  const handleSave = async () => {
    if (daysBefore.length === 0) {
      toast.error('You must have at least one reminder day')
      return
    }
    setSaving(true)
    try {
      const updated = await updateReminderSettings({
        reminder_days_before: daysBefore,
      })
      setSettings(updated)
      toast.success('Reminder settings updated successfully')
    } catch (error) {
      console.error('Failed to update reminder settings:', error)
      toast.error('Failed to update reminder settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Reminder Timing
          </CardTitle>
          <CardDescription>
            Configure when you want to be reminded before your subscriptions renew.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Reminder Timing
        </CardTitle>
        <CardDescription>
          Configure when you want to be reminded before your subscriptions renew.
          Reminders will be sent at the specified number of days before renewal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current reminder days */}
        <div>
          <Label className="text-sm font-medium">Current Reminder Days</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {daysBefore.map((day) => (
              <Badge key={day} variant="secondary" className="flex items-center gap-1">
                {day} day{day !== 1 ? 's' : ''} before
                <button
                  onClick={() => handleRemoveDay(day)}
                  aria-label={`Remove ${day} day${day !== 1 ? 's' : ''} before reminder`}
                  className="ml-1 hover:bg-gray-200 rounded-full p-0.5"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        {/* Add new day */}
        <div>
          <Label htmlFor="newDay" className="text-sm font-medium">Add Reminder Day</Label>
          <div className="flex gap-2 mt-2">
            <Input
              id="newDay"
              type="number"
              placeholder="e.g. 14"
              value={newDay}
              onChange={(e) => setNewDay(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddDay()}
              min="1"
              max="365"
              className="w-32"
            />
            <Button onClick={handleAddDay} size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Enter the number of days before renewal (1-365)
          </p>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}