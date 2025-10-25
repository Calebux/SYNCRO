"use client"

// This will be the main dashboard that receives data from the server component

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

interface DashboardClientProps {
  initialSubscriptions: any[]
  initialEmailAccounts: any[]
  initialTeamMembers: any[]
  initialNotifications: any[]
  initialProfile: any
  user: User
}

export default function DashboardClient({
  initialSubscriptions,
  initialEmailAccounts,
  initialTeamMembers,
  initialNotifications,
  initialProfile,
  user,
}: DashboardClientProps) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions)
  const [emailAccounts, setEmailAccounts] = useState(initialEmailAccounts)
  const [teamMembers, setTeamMembers] = useState(initialTeamMembers)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [profile, setProfile] = useState(initialProfile)

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/auth/login"
  }

  // TODO: Move all the app logic from app/page.tsx here
  // For now, return a placeholder

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <button onClick={handleSignOut} className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">
          Sign Out
        </button>
      </div>
      <div className="space-y-4">
        <p>Welcome, {profile?.full_name || user.email}!</p>
        <p>Subscriptions: {subscriptions.length}</p>
        <p>Email Accounts: {emailAccounts.length}</p>
        <p>Team Members: {teamMembers.length}</p>
        <p>Notifications: {notifications.length}</p>
      </div>
    </div>
  )
}
