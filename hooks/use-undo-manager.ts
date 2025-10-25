"use client"

import { useState, useCallback } from "react"

const MAX_HISTORY_SIZE = 50

export function useUndoManager<T>(initialState: T) {
  const [history, setHistory] = useState<T[]>([initialState])
  const [historyIndex, setHistoryIndex] = useState(0)

  const addToHistory = useCallback(
    (newState: T) => {
      setHistory((prev) => {
        // Remove future states if we're not at the end
        const newHistory = prev.slice(0, historyIndex + 1)

        // Add new state
        newHistory.push(newState)

        // Limit history size (keep most recent 50)
        if (newHistory.length > MAX_HISTORY_SIZE) {
          return newHistory.slice(newHistory.length - MAX_HISTORY_SIZE)
        }

        return newHistory
      })

      setHistoryIndex((prev) => {
        const newIndex = prev + 1
        return newIndex >= MAX_HISTORY_SIZE ? MAX_HISTORY_SIZE - 1 : newIndex
      })
    },
    [historyIndex],
  )

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1)
      return history[historyIndex - 1]
    }
    return null
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex((prev) => prev + 1)
      return history[historyIndex + 1]
    }
    return null
  }, [history, historyIndex])

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1
  const historySize = history.length

  return {
    currentState: history[historyIndex],
    addToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    historySize,
  }
}
