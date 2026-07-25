import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ReferralPanel } from "@/components/settings/ReferralPanel"

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
      </header>

      <main id="main-content" className="px-4 sm:px-8 py-6 space-y-6 max-w-2xl">
        {/* Referral program */}
        <ReferralPanel />

        {/* Navigation to sub-settings */}
        <nav aria-label="Settings sections" className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {[
            { href: "/settings/wallet", label: "Wallet Management" },
            { href: "/settings/security", label: "Security & Two-Factor Authentication" },
            { href: "/settings/privacy",  label: "Privacy & Data" },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="flex items-center justify-between px-6 py-4 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {label}
              <span aria-hidden="true" className="text-gray-400">›</span>
            </a>
          ))}
        </nav>
      </main>
    </div>
  )
}
