import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import DashboardClient from "@/components/dashboard-client"
import { trackError } from "@/lib/telemetry"

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    if (userError) {
      trackError(userError, "auth", { component: "DashboardPage", userId: user?.id })
    }
    redirect("/auth/login")
  }

  const [
    subscriptionsRes,
    emailAccountsRes,
    teamMembersRes,
    notificationsRes,
    profileRes,
  ] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id, name, price, status, billing_cycle, next_renewal, category")
      .order("created_at", { ascending: false }),
    supabase.from("email_accounts").select("id, email, provider, last_synced"),
    supabase.from("team_members").select("id, user_id, role, invited_at"),
    supabase
      .from("notifications")
      .select("id, message, type, read, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("profiles").select("id, full_name, avatar_url, plan").eq("id", user.id).single(),
  ])

  // Collect errors
  const errors: Record<string, any> = {}

  if (subscriptionsRes.error) {
    errors.subscriptions = subscriptionsRes.error
    trackError(subscriptionsRes.error, "database", { 
      query: "subscriptions", 
      component: "DashboardPage", 
      userId: user.id 
    })
  }

  if (emailAccountsRes.error) {
    errors.emailAccounts = emailAccountsRes.error
    trackError(emailAccountsRes.error, "database", { 
      query: "email_accounts", 
      component: "DashboardPage", 
      userId: user.id 
    })
  }

  if (teamMembersRes.error) {
    errors.teamMembers = teamMembersRes.error
    trackError(teamMembersRes.error, "database", { 
      query: "team_members", 
      component: "DashboardPage", 
      userId: user.id 
    })
  }

  if (notificationsRes.error) {
    errors.notifications = notificationsRes.error
    trackError(notificationsRes.error, "database", { 
      query: "notifications", 
      component: "DashboardPage", 
      userId: user.id 
    })
  }

  if (profileRes.error) {
    errors.profile = profileRes.error
    trackError(profileRes.error, "database", { 
      query: "profiles", 
      component: "DashboardPage", 
      userId: user.id 
    })
  }

  return (
    <DashboardClient
      initialSubscriptions={subscriptionsRes.data || []}
      initialEmailAccounts={emailAccountsRes.data || []}
      initialTeamMembers={teamMembersRes.data || []}
      initialNotifications={notificationsRes.data || []}
      initialProfile={profileRes.data}
      user={user}
      errors={errors}
    />
  )
}
