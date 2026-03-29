import { createClient } from "@/lib/supabase/server"

export interface SubscriptionTag {
  id: string
  user_id: string
  name: string
  color: string
  subscription_count?: number
}

export interface TagAssignment {
  subscription_id: string
  tag_id: string
}

/** Fetch all tags for the authenticated user, with subscription counts. */
export async function fetchUserTags(userId: string): Promise<SubscriptionTag[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("subscription_tags")
    .select("id, user_id, name, color")
    .eq("user_id", userId)
    .order("name")

  if (error) throw new Error(`Failed to fetch tags: ${error.message}`)
  return (data ?? []) as SubscriptionTag[]
}

/** Create a new tag for the user. Returns the created tag. */
export async function createTag(
  userId: string,
  name: string,
  color: string = "#6366f1",
): Promise<SubscriptionTag> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("subscription_tags")
    .insert({ user_id: userId, name: name.trim(), color })
    .select()
    .single()

  if (error) throw new Error(`Failed to create tag: ${error.message}`)
  return data as SubscriptionTag
}

/** Delete a tag and all its assignments (cascade handled by DB). */
export async function deleteTag(tagId: string, userId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("subscription_tags")
    .delete()
    .eq("id", tagId)
    .eq("user_id", userId)

  if (error) throw new Error(`Failed to delete tag: ${error.message}`)
}

/** Fetch tag IDs assigned to a subscription. */
export async function getSubscriptionTagIds(
  subscriptionId: string,
): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("subscription_tag_assignments")
    .select("tag_id")
    .eq("subscription_id", subscriptionId)

  if (error) throw new Error(`Failed to fetch tag assignments: ${error.message}`)
  return (data ?? []).map((r: { tag_id: string }) => r.tag_id)
}

/** Assign a tag to a subscription. Idempotent (upsert). */
export async function addTagToSubscription(
  subscriptionId: string,
  tagId: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("subscription_tag_assignments")
    .upsert({ subscription_id: subscriptionId, tag_id: tagId })

  if (error) throw new Error(`Failed to assign tag: ${error.message}`)
}

/** Remove a tag from a subscription. */
export async function removeTagFromSubscription(
  subscriptionId: string,
  tagId: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("subscription_tag_assignments")
    .delete()
    .eq("subscription_id", subscriptionId)
    .eq("tag_id", tagId)

  if (error) throw new Error(`Failed to remove tag: ${error.message}`)
}

/** Update the notes field of a subscription. */
export async function updateSubscriptionNotes(
  subscriptionId: string,
  userId: string,
  notes: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("subscriptions")
    .update({ notes })
    .eq("id", subscriptionId)
    .eq("user_id", userId)

  if (error) throw new Error(`Failed to update notes: ${error.message}`)
}
