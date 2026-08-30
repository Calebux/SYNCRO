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

/**
 * Fetch tag IDs assigned to a subscription.
 *
 * Requires the authenticated user's id: ownership is validated against
 * subscriptions.user_id before assignments are fetched, so this helper is
 * safe to call from routes that have not performed their own ownership check.
 * Throws if the subscription does not exist or belongs to another user.
 */
export async function getSubscriptionTagIds(
  subscriptionId: string,
  userId: string,
): Promise<string[]> {
  const supabase = await createClient()

  const { data: subscription, error: ownershipError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("id", subscriptionId)
    .eq("user_id", userId)
    .maybeSingle()

  if (ownershipError)
    throw new Error(`Failed to verify subscription ownership: ${ownershipError.message}`)
  if (!subscription)
    throw new Error("Subscription not found for this user")

  const { data, error } = await supabase
    .from("subscription_tag_assignments")
    .select("tag_id")
    .eq("subscription_id", subscriptionId)

  if (error) throw new Error(`Failed to fetch tag assignments: ${error.message}`)
  return (data ?? []).map((r: { tag_id: string }) => r.tag_id)
}

/**
 * Verify the subscription and tag both belong to userId.
 * Throws if either resource is missing or owned by another user.
 */
async function assertSubscriptionAndTagOwnership(
  userId: string,
  subscriptionId: string,
  tagId: string,
): Promise<void> {
  const supabase = await createClient()

  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("id", subscriptionId)
    .single()

  if (subError || !subscription) {
    throw new Error("Subscription not found")
  }

  if (subscription.user_id !== userId) {
    throw new Error("Subscription does not belong to user")
  }

  const { data: tag, error: tagError } = await supabase
    .from("subscription_tags")
    .select("user_id")
    .eq("id", tagId)
    .single()

  if (tagError || !tag) {
    throw new Error("Tag not found")
  }

  if (tag.user_id !== userId) {
    throw new Error("Tag does not belong to user")
  }
}

/**
 * Assign a tag to a subscription. Idempotent (upsert).
 * Requires userId and verifies both subscription and tag ownership.
 */
export async function addTagToSubscription(
  userId: string,
  subscriptionId: string,
  tagId: string,
): Promise<void> {
  await assertSubscriptionAndTagOwnership(userId, subscriptionId, tagId)

  const supabase = await createClient()
  const { error } = await supabase
    .from("subscription_tag_assignments")
    .upsert({ subscription_id: subscriptionId, tag_id: tagId })

  if (error) throw new Error(`Failed to assign tag: ${error.message}`)
}

/**
 * Remove a tag from a subscription.
 * Requires userId and verifies both subscription and tag ownership.
 */
export async function removeTagFromSubscription(
  userId: string,
  subscriptionId: string,
  tagId: string,
): Promise<void> {
  await assertSubscriptionAndTagOwnership(userId, subscriptionId, tagId)

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
