"use client"

import { useState, useEffect, useCallback } from "react"

export interface Tag {
  id: string
  name: string
  color: string
}

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/tags")
      const json = await res.json()
      if (json.success) setTags(json.data.tags ?? [])
    } catch {
      // silently ignore — tags are non-critical
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  const createTag = useCallback(
    async (name: string, color: string): Promise<Tag | null> => {
      try {
        const res = await fetch("/api/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color }),
        })
        const json = await res.json()
        if (json.success) {
          const newTag: Tag = json.data.tag
          setTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)))
          return newTag
        }
      } catch {}
      return null
    },
    [],
  )

  const deleteTag = useCallback(async (tagId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/tags/${tagId}`, { method: "DELETE" })
      if (res.ok) {
        setTags((prev) => prev.filter((t) => t.id !== tagId))
        return true
      }
    } catch {}
    return false
  }, [])

  const addTagToSubscription = useCallback(
    async (subscriptionId: string, tagId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/subscriptions/${subscriptionId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_id: tagId }),
        })
        return res.ok
      } catch {
        return false
      }
    },
    [],
  )

  const removeTagFromSubscription = useCallback(
    async (subscriptionId: string, tagId: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/subscriptions/${subscriptionId}/tags/${tagId}`,
          { method: "DELETE" },
        )
        return res.ok
      } catch {
        return false
      }
    },
    [],
  )

  const saveNotes = useCallback(
    async (subscriptionId: string, notes: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/subscriptions/${subscriptionId}/notes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes }),
        })
        return res.ok
      } catch {
        return false
      }
    },
    [],
  )

  return {
    tags,
    loading,
    createTag,
    deleteTag,
    addTagToSubscription,
    removeTagFromSubscription,
    saveNotes,
    refetch: fetchTags,
  }
}
