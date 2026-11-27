/**
 * Canonical store for platform-level admin settings.
 *
 * Writes update an in-process cache and upsert a singleton row in
 * `app_settings` so values survive process restarts.
 */

import { createClient } from "@/lib/supabase/server"

export type AdminSettings = {
  maintenanceMode: boolean
  enableRegistration: boolean
  rateLimitThreshold: number
}

export type AdminSettingsUpdate = Partial<AdminSettings>

const DEFAULT_SETTINGS: AdminSettings = {
  maintenanceMode: false,
  enableRegistration: true,
  rateLimitThreshold: 100,
}

const SETTINGS_ROW_ID = "platform"

let cachedSettings: AdminSettings = { ...DEFAULT_SETTINGS }

/** Reset cache to defaults — for tests only. */
export function resetAdminSettingsStore(): void {
  cachedSettings = { ...DEFAULT_SETTINGS }
}

export function getCachedAdminSettings(): AdminSettings {
  return { ...cachedSettings }
}

function mergeSettings(updates: AdminSettingsUpdate): AdminSettings {
  return {
    ...cachedSettings,
    ...(updates.maintenanceMode !== undefined
      ? { maintenanceMode: updates.maintenanceMode }
      : {}),
    ...(updates.enableRegistration !== undefined
      ? { enableRegistration: updates.enableRegistration }
      : {}),
    ...(updates.rateLimitThreshold !== undefined
      ? { rateLimitThreshold: updates.rateLimitThreshold }
      : {}),
  }
}

/**
 * Load settings from the database into the cache, falling back to defaults
 * when the row is missing or the query fails.
 */
export async function getAdminSettings(): Promise<AdminSettings> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("app_settings")
      .select("maintenance_mode, enable_registration, rate_limit_threshold")
      .eq("id", SETTINGS_ROW_ID)
      .maybeSingle()

    if (!error && data) {
      cachedSettings = {
        maintenanceMode: Boolean(data.maintenance_mode),
        enableRegistration: Boolean(data.enable_registration),
        rateLimitThreshold:
          Number(data.rate_limit_threshold) || DEFAULT_SETTINGS.rateLimitThreshold,
      }
    }
  } catch {
    // Keep cached / default values when DB is unavailable
  }

  return getCachedAdminSettings()
}

/**
 * Merge and persist supported settings. Returns the full saved state
 * (not just the submitted partial body).
 */
export async function updateAdminSettings(
  updates: AdminSettingsUpdate
): Promise<AdminSettings> {
  const next = mergeSettings(updates)

  const supabase = await createClient()
  const { error } = await supabase.from("app_settings").upsert(
    {
      id: SETTINGS_ROW_ID,
      maintenance_mode: next.maintenanceMode,
      enable_registration: next.enableRegistration,
      rate_limit_threshold: next.rateLimitThreshold,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  )

  if (error) {
    throw new Error(`Failed to persist admin settings: ${error.message}`)
  }

  cachedSettings = next
  return getCachedAdminSettings()
}
