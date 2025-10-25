import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import DashboardClient from "@/components/dashboard-client"

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const [
    { data: subscriptions },
    { data: emailAccounts },
    { data: teamMembers },
    { data: notifications },
    { data: profile },
  ] = await Promise.all([
    supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
    supabase.from("email_accounts").select("*"),
    supabase.from("team_members").select("*"),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("*").eq("id", user.id).single(),
  ])

  return (
    <DashboardClient
      initialSubscriptions={subscriptions || []}
      initialEmailAccounts={emailAccounts || []}
      initialTeamMembers={teamMembers || []}
      initialNotifications={notifications || []}
      initialProfile={profile}
      user={user}
    />
  )
}
