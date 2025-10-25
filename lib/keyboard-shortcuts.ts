"use client"

import { useEffect } from "react"

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  description: string
  action: () => void
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey
        const altMatch = shortcut.alt ? event.altKey : !event.altKey

        if (event.key.toLowerCase() === shortcut.key.toLowerCase() && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault()
          shortcut.action()
          break
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [shortcuts, enabled])
}

// Global keyboard shortcuts
export const GLOBAL_SHORTCUTS: KeyboardShortcut[] = [
  {
    key: "/",
    description: "Focus search",
    action: () => {
      const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement
      searchInput?.focus()
    },
  },
  {
    key: "k",
    ctrl: true,
    description: "Open command palette",
    action: () => {
      const event = new CustomEvent("open-command-palette")
      window.dispatchEvent(event)
    },
  },
  {
    key: "n",
    ctrl: true,
    description: "New subscription",
    action: () => {
      const event = new CustomEvent("open-add-subscription")
      window.dispatchEvent(event)
    },
  },
  {
    key: "Escape",
    description: "Close modal/dialog",
    action: () => {
      const event = new CustomEvent("close-modal")
      window.dispatchEvent(event)
    },
  },
]
