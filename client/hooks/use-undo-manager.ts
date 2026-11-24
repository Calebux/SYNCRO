"use client"

import { useState, useCallback, useRef } from "react"

const MAX_HISTORY_SIZE = 50

export function useUndoManager<T>(initialState: T) {
  const [history, setHistory] = useState<T[]>([initialState])
  const [historyIndex, setHistoryIndex] = useState(0)
  const historyRef = useRef<T[]>([initialState])
  const historyIndexRef = useRef(0)

  const addToHistory = useCallback(
    (newState: T) => {
      setHistory((prev) => {
        // Remove future states using the latest index, not a stale render closure.
        const newHistory = prev.slice(0, historyIndexRef.current + 1)

        // Add new state
        newHistory.push(newState)

        // Limit history size (keep most recent 50)
        const boundedHistory =
          newHistory.length > MAX_HISTORY_SIZE
            ? newHistory.slice(newHistory.length - MAX_HISTORY_SIZE)
            : newHistory

        historyRef.current = boundedHistory
        historyIndexRef.current = boundedHistory.length - 1
        setHistoryIndex(historyIndexRef.current)

        return boundedHistory
      })
    },
    [],
  )

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      const newIndex = historyIndexRef.current - 1
      historyIndexRef.current = newIndex
      setHistoryIndex(newIndex)
      return historyRef.current[newIndex]
    }
    return null
  }, [])

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      const newIndex = historyIndexRef.current + 1
      historyIndexRef.current = newIndex
      setHistoryIndex(newIndex)
      return historyRef.current[newIndex]
    }
    return null
  }, [])

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
