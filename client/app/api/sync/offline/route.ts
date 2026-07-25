import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { trackError } from "@/lib/telemetry"

// Conflict resolution: Last-write-wins strategy with version tracking
async function resolveConflict(
  existingSubscription: any,
  updates: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const existingVersion = existingSubscription.version || 0
  const updateVersion = updates.version || 0

  // Last-write-wins: if server version is higher, reject client changes
  if (existingVersion > updateVersion) {
    return {
      ...updates,
      _conflict: true,
      _serverData: existingSubscription,
    }
  }

  // Merge changes with server data
  return {
    ...existingSubscription,
    ...updates,
    version: Math.max(existingVersion, updateVersion) + 1,
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const mutation = await request.json()

  const { type, payload } = mutation

  try {
    if (type === "create") {
      const { data, error } = await supabase
        .from("subscriptions")
        .insert({
          user_id: user.id,
          ...payload,
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ success: true, data })
    }

    if (type === "update") {
      const id = payload.id as string

      // Check for conflicts
      const { data: existing, error: fetchError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single()

      if (fetchError && fetchError.code === "PGRST116") {
        // Subscription not found - may have been deleted
        return NextResponse.json({ error: "Subscription not found" }, { status: 404 })
      }

      if (fetchError) {
        return NextResponse.json({ error: fetchError.message }, { status: 400 })
      }

      // Check for conflict (optimistic locking)
      if (payload.version && existing.version && payload.version < existing.version) {
        const resolved = await resolveConflict(existing, payload)
        return NextResponse.json({ 
          error: "Conflict detected", 
          conflict: true,
          resolvedData: resolved,
        }, { status: 409 })
      }

      const { data, error } = await supabase
        .from("subscriptions")
        .update({
          ...payload,
          version: (existing.version || 0) + 1,
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ success: true, data })
    }

    if (type === "delete") {
      const id = payload.id as string

      const { error } = await supabase
        .from("subscriptions")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Unknown mutation type" }, { status: 400 })
  } catch (error) {
    trackError(error, "sync", { type, userId: user.id })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}