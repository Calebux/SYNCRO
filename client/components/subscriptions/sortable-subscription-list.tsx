"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import type { ReactNode } from "react"
import { useMemo } from "react"

interface SortableSubscriptionListProps<T extends { id: string }> {
  items: T[]
  onReorder: (fromIndex: number, toIndex: number) => void
  renderItem: (item: T, index: number) => ReactNode
  darkMode?: boolean
  ariaLabel?: string
}

export function SortableSubscriptionList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  darkMode,
  ariaLabel = "Subscription list, drag to reorder by priority",
}: SortableSubscriptionListProps<T>) {
  const itemIds = useMemo(() => items.map((item) => item.id), [items])

  const sensors = useMemo(
    () => [
      new PointerSensor({
        activationConstraint: { distance: 8 },
      }),
      new TouchSensor({
        activationConstraint: { delay: 200, tolerance: 6 },
      }),
      new KeyboardSensor({
        coordinateGetter: sortableKeyboardCoordinates,
      }),
    ],
    [],
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    const fromIndex = itemIds.indexOf(String(active.id))
    const toIndex = itemIds.indexOf(String(over.id))

    if (fromIndex === -1 || toIndex === -1) {
      return
    }

    onReorder(fromIndex, toIndex)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div
          role="list"
          aria-label={ariaLabel}
          className={`space-y-3 ${darkMode ? "" : ""}`}
        >
          {items.map((item, index) => (
            <div key={item.id} role="listitem" className="transition-transform duration-200">
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
