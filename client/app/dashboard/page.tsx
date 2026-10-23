import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PrincipalOverview } from "./overview/principal-overview"

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

  return <PrincipalOverview />
}
