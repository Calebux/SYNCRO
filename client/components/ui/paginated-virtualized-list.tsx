"use client"

import type React from "react"
import { useRef, useState, useCallback, useEffect } from "react"
import { VirtualizedList } from "./virtualized-list"

interface CursorPageInfo {
  cursor: string | null
  hasMore: boolean
}

interface PaginatedVirtualizedListProps<T extends { id: string }> {
  initialItems: T[]
  itemHeight: number
  containerHeight: number
  renderItem: (item: T, index: number) => React.ReactNode
  onFetchPage: (cursor: string | null) => Promise<{ items: T[]; pageInfo: CursorPageInfo }>
  overscan?: number
  ariaLabel?: string
}

export function PaginatedVirtualizedList<T extends { id: string }>({
  initialItems,
  itemHeight,
  containerHeight,
  renderItem,
  onFetchPage,
  overscan = 3,
  ariaLabel = "Paginated list",
}: PaginatedVirtualizedListProps<T>) {
  const [items, setItems] = useState<T[]>(initialItems)
  const [pageInfo, setPageInfo] = useState<CursorPageInfo>({
    cursor: null,
    hasMore: true,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

  const handleLoadMore = useCallback(
    async (lastItemId: string) => {
      // Prevent duplicate loads
      if (loadingRef.current || !pageInfo.hasMore || isLoading) {
        return
      }

      loadingRef.current = true
      setIsLoading(true)
      setError(null)

      try {
        const { items: newItems, pageInfo: newPageInfo } = await onFetchPage(
          pageInfo.cursor || lastItemId
        )

        // Merge items, avoiding duplicates
        const existingIds = new Set(items.map((item) => item.id))
        const uniqueNewItems = newItems.filter((item) => !existingIds.has(item.id))

        if (uniqueNewItems.length > 0) {
          setItems((prev) => [...prev, ...uniqueNewItems])
        }

        setPageInfo(newPageInfo)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load more items")
        console.error("Pagination error:", err)
      } finally {
        setIsLoading(false)
        loadingRef.current = false
      }
    },
    [pageInfo, items, isLoading, onFetchPage]
  )

  return (
    <div className="flex flex-col gap-2">
      <VirtualizedList
        items={items}
        itemHeight={itemHeight}
        containerHeight={containerHeight}
        renderItem={renderItem}
        overscan={overscan}
        onLoadMore={handleLoadMore}
        hasMore={pageInfo.hasMore}
        isLoading={isLoading}
        ariaLabel={ariaLabel}
        role="list"
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {error}
          <button
            onClick={() => {
              const lastItem = items[items.length - 1]
              if (lastItem?.id) {
                handleLoadMore(lastItem.id)
              }
            }}
            className="ml-2 font-medium underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
