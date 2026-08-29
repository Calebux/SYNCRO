"use client"

import type React from "react"
import { useRef, useState, useCallback, useEffect } from "react"

interface VirtualizedListProps<T extends { id: string }> {
  items: T[]
  itemHeight: number
  containerHeight: number
  renderItem: (item: T, index: number) => React.ReactNode
  overscan?: number
  onLoadMore?: (cursor: string) => Promise<void>
  hasMore?: boolean
  isLoading?: boolean
  ariaLabel?: string
  role?: string
}

export function VirtualizedList<T extends { id: string }>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
  onLoadMore,
  hasMore = false,
  isLoading = false,
  ariaLabel = "List",
  role = "list",
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map())

  const totalHeight = items.length * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const endIndex = Math.min(items.length - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan)

  const visibleItems = items.slice(startIndex, endIndex + 1)
  const offsetY = startIndex * itemHeight

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    setScrollTop(target.scrollTop)

    // Trigger load more when scrolling near the bottom
    if (onLoadMore && hasMore && !isLoading) {
      const scrollPercentage = (target.scrollTop + containerHeight) / (totalHeight || 1)
      if (scrollPercentage > 0.8) {
        const lastItem = items[items.length - 1]
        if (lastItem?.id) {
          onLoadMore(lastItem.id)
        }
      }
    }
  }, [containerHeight, totalHeight, items, onLoadMore, hasMore, isLoading])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (focusedIndex === null) return

    const lastVisibleIndex = Math.min(endIndex, items.length - 1)

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        const nextIndex = Math.min(focusedIndex + 1, items.length - 1)
        setFocusedIndex(nextIndex)
        itemRefs.current.get(nextIndex)?.focus()
        // Auto-scroll if needed
        if (nextIndex > endIndex) {
          containerRef.current?.scrollBy({ top: itemHeight, behavior: "smooth" })
        }
        break

      case "ArrowUp":
        e.preventDefault()
        const prevIndex = Math.max(focusedIndex - 1, 0)
        setFocusedIndex(prevIndex)
        itemRefs.current.get(prevIndex)?.focus()
        // Auto-scroll if needed
        if (prevIndex < startIndex) {
          containerRef.current?.scrollBy({ top: -itemHeight, behavior: "smooth" })
        }
        break

      case "Home":
        e.preventDefault()
        setFocusedIndex(0)
        containerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
        itemRefs.current.get(0)?.focus()
        break

      case "End":
        e.preventDefault()
        const endIdx = items.length - 1
        setFocusedIndex(endIdx)
        containerRef.current?.scrollTo({ top: totalHeight, behavior: "smooth" })
        itemRefs.current.get(endIdx)?.focus()
        break

      case "PageDown":
        e.preventDefault()
        const pageDownIndex = Math.min(focusedIndex + 5, items.length - 1)
        setFocusedIndex(pageDownIndex)
        itemRefs.current.get(pageDownIndex)?.focus()
        containerRef.current?.scrollBy({ top: itemHeight * 5, behavior: "smooth" })
        break

      case "PageUp":
        e.preventDefault()
        const pageUpIndex = Math.max(focusedIndex - 5, 0)
        setFocusedIndex(pageUpIndex)
        itemRefs.current.get(pageUpIndex)?.focus()
        containerRef.current?.scrollBy({ top: -itemHeight * 5, behavior: "smooth" })
        break
    }
  }, [focusedIndex, startIndex, endIndex, items.length, itemHeight, totalHeight])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      role={role}
      aria-label={ariaLabel}
      aria-busy={isLoading}
      style={{ height: containerHeight, overflow: "auto" }}
      className="relative focus:outline-none"
      tabIndex={0}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div ref={innerRef} style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, relativeIndex) => {
            const absoluteIndex = startIndex + relativeIndex
            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) {
                    itemRefs.current.set(absoluteIndex, el)
                  }
                }}
                role="listitem"
                tabIndex={focusedIndex === absoluteIndex ? 0 : -1}
                style={{
                  height: itemHeight,
                  outline: "none",
                }}
                onFocus={() => setFocusedIndex(absoluteIndex)}
              >
                {renderItem(item, absoluteIndex)}
              </div>
            )
          })}
        </div>
      </div>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          Loading more items...
        </div>
      )}
    </div>
  )
}
