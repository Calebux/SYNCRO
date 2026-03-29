"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Pencil, Check, ChevronDown, ChevronUp } from "lucide-react"

interface NotesEditorProps {
  subscriptionId: string
  initialNotes: string
  onSave: (subscriptionId: string, notes: string) => Promise<boolean>
  darkMode?: boolean
}

/** Minimal markdown → HTML: bold, italic, links. */
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline text-blue-500">$1</a>')
    .replace(/\n/g, "<br/>")
}

export function NotesEditor({
  subscriptionId,
  initialNotes,
  onSave,
  darkMode,
}: NotesEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(initialNotes)
  const [saved, setSaved] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerSave = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setSaved(false)
      debounceRef.current = setTimeout(async () => {
        const ok = await onSave(subscriptionId, value)
        if (ok) setSaved(true)
      }, 1000)
    },
    [subscriptionId, onSave],
  )

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setNotes(value)
    triggerSave(value)
  }

  const sectionCls = `mt-4 rounded-lg border ${
    darkMode ? "border-[#374151]" : "border-gray-200"
  }`

  const headerCls = `flex items-center justify-between w-full px-4 py-2.5 text-left ${
    darkMode ? "text-gray-300 hover:bg-[#374151]/40" : "text-gray-700 hover:bg-gray-50"
  } rounded-lg transition-colors`

  return (
    <div className={sectionCls}>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={headerCls}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Pencil className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">Notes</span>
          {notes && !expanded && (
            <span className={`text-xs truncate max-w-[180px] ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
              {notes.split("\n")[0]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!saved && (
            <span className="text-xs text-amber-500">saving…</span>
          )}
          {saved && notes && (
            <Check className="w-3.5 h-3.5 text-green-500" />
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4">
          {editing ? (
            <textarea
              autoFocus
              value={notes}
              onChange={handleChange}
              onBlur={() => setEditing(false)}
              rows={4}
              placeholder={
                "Add a note… (supports **bold**, *italic*, [links](url))"
              }
              className={`w-full px-3 py-2 text-sm border rounded-lg resize-none focus:outline-none focus:ring-1 ${
                darkMode
                  ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166] placeholder:text-gray-600"
                  : "bg-white border-gray-200 text-gray-900 focus:ring-black placeholder:text-gray-400"
              }`}
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setEditing(true)}
              onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
              className={`min-h-[60px] px-3 py-2 text-sm rounded-lg cursor-text ${
                darkMode
                  ? "text-gray-300 hover:bg-[#1E2A35]"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {notes ? (
                <div
                  className="prose-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(notes) }}
                />
              ) : (
                <span className={darkMode ? "text-gray-600" : "text-gray-400"}>
                  Click to add a note… (**bold**, *italic*, [links](url))
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
