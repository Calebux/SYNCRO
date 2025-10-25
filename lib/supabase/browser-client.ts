import { createBrowserClient } from "@supabase/ssr"

let client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowserClient() {
  if (client) {
    return client
  }

  client = createBrowserClient(
    process.env.SUPABASE_NEXT_PUBLIC_SUPABASE_URL!,
    proSUPABASE_NEXT_PUBLIC_SUPABASE_ANON_KEY_ANON_KEY!,
  )

  return client
}
