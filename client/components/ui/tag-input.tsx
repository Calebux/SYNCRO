"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { X, Plus, Tag as TagIcon } from "lucide-react"
import type { Tag } from "@/hooks/use-tags"

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#64748b",
]

interface TagInputProps {
  /** All tags available to the current user */
  allTags: Tag[]
  /** IDs of tags currently assigned to this subscription */
  selectedTagIds: string[]
  onAdd: (tagId: string) => void
  onRemove: (tagId: string) => void
  onCreateTag: (name: string, color: string) => Promise<Tag | null>
  darkMode?: boolean
}

export function TagInput({
  allTags,
  selectedTagIds,
  onAdd,
  onRemove,
  onCreateTag,
  darkMode,
}: TagInputProps) {
  const [query, setQuery] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
        setShowColorPicker(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const selectedTags = allTags.filter((t) => selectedTagIds.includes(t.id))
  const unselectedTags = allTags.filter((t) => !selectedTagIds.includes(t.id))

  const filtered = query.trim()
    ? unselectedTags.filter((t) =>
        t.name.toLowerCase().includes(query.toLowerCase()),
      )
    : unselectedTags

  const exactMatch = allTags.find(
    (t) => t.name.toLowerCase() === query.trim().toLowerCase(),
  )
  const canCreate = query.trim().length > 0 && !exactMatch

  const handleSelect = useCallback(
    (tag: Tag) => {
      onAdd(tag.id)
      setQuery("")
      inputRef.current?.focus()
    },
    [onAdd],
  )

  const handleCreate = useCallback(async () => {
    if (!canCreate || creating) return
    setCreating(true)
    const tag = await onCreateTag(query.trim(), newColor)
    setCreating(false)
    if (tag) {
      onAdd(tag.id)
      setQuery("")
      setShowColorPicker(false)
    }
  }, [canCreate, creating, onCreateTag, query, newColor, onAdd])

  const inputCls = `w-full px-2 py-1 text-sm bg-transparent outline-none placeholder:text-gray-400 ${
    darkMode ? "text-white" : "text-gray-900"
  }`

  const dropdownCls = `absolute left-0 top-full mt-1 w-full rounded-lg border shadow-lg z-50 max-h-52 overflow-y-auto ${
    darkMode ? "bg-[#1E2A35] border-[#374151]" : "bg-white border-gray-200"
  }`

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tag pills */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
              <button
                type="button"
                onClick={() => onRemove(tag.id)}
                aria-label={`Remove tag ${tag.name}`}
                className="hover:opacity-75 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div
        className={`flex items-center gap-2 px-3 py-2 border rounded-lg ${
          darkMode
            ? "bg-[#1E2A35] border-[#374151] focus-within:ring-1 focus-within:ring-[#FFD166]"
            : "bg-white border-gray-300 focus-within:ring-1 focus-within:ring-black"
        }`}
      >
        <TagIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowDropdown(true)
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder={selectedTags.length === 0 ? "Add tags…" : "Add more…"}
          className={inputCls}
        />
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className={dropdownCls}>
          {filtered.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => handleSelect(tag)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                darkMode
                  ? "text-gray-300 hover:bg-[#2D3748]"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
            </button>
          ))}

          {/* Create new tag */}
          {canCreate && (
            <div>
              {!showColorPicker ? (
                <button
                  type="button"
                  onClick={() => setShowColorPicker(true)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                    darkMode
                      ? "text-[#FFD166] hover:bg-[#2D3748]"
                      : "text-indigo-600 hover:bg-gray-50"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create &ldquo;{query.trim()}&rdquo;
                </button>
              ) : (
                <div className={`px-3 py-2 border-t ${darkMode ? "border-[#374151]" : "border-gray-100"}`}>
                  <p className={`text-xs mb-2 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                    Pick a colour
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewColor(c)}
                        className={`w-5 h-5 rounded-full transition-transform ${
                          newColor === c ? "scale-125 ring-2 ring-offset-1 ring-gray-400" : ""
                        }`}
                        style={{ backgroundColor: c }}
                        aria-label={`Select colour ${c}`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full py-1.5 rounded-md text-xs font-semibold text-white transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: newColor }}
                  >
                    {creating ? "Creating…" : `Create "${query.trim()}"`}
                  </button>
                </div>
              )}
            </div>
          )}

          {filtered.length === 0 && !canCreate && (
            <p className={`px-3 py-3 text-sm ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
              No tags found
            </p>
          )}
        </div>
      )}
    </div>
  )
}
