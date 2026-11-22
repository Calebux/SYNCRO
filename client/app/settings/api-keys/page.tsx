import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ApiKeyManager } from "@/components/settings/ApiKeyManager"

export default async function ApiKeysPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect("/auth/login")

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-8">
        <a href="/settings" className="text-sm text-blue-600 hover:underline">← Settings</a>
        <h1 className="mt-2 text-xl font-bold text-gray-900">API key management</h1>
        <p className="mt-1 text-sm text-gray-600">Create, inspect, rotate, and revoke credentials for your integrations.</p>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-8">
        <ApiKeyManager />
      </main>
    </div>
  )
}
