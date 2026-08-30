"use client"

import { CSS } from "@dnd-kit/utilities"
import { useSortable } from "@dnd-kit/sortable"
import type { CSSProperties, ReactNode } from "react"
import { GripVertical } from "lucide-react"
import type { PriorityRank } from "@/lib/subscription-priority-order"

const PRIORITY_STYLES: Record<
  PriorityRank,
  { label: string; className: string }
> = {
  1: {
    label: "Top priority",
    className: "bg-[#FFD166] text-[#1E2A35]",
  },
  2: {
    label: "Second priority",
    className: "bg-[#CBD5E0] text-[#1E2A35]",
  },
  3: {
    label: "Third priority",
    className: "bg-[#E86A33] text-white",
  },
}

interface PriorityBadgeProps {
  rank: PriorityRank
  darkMode?: boolean
}

export function PriorityBadge({ rank }: PriorityBadgeProps) {
  const style = PRIORITY_STYLES[rank]

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold ${style.className}`}
      aria-label={`${style.label}, priority ${rank}`}
    >
      <span aria-hidden="true">#{rank}</span>
    </span>
  )
}

interface SortableDragHandleProps {
  attributes: ReturnType<typeof useSortable>["attributes"]
  listeners: ReturnType<typeof useSortable>["listeners"]
  darkMode?: boolean
  label: string
}

export function SortableDragHandle({
  attributes,
  listeners,
  darkMode,
  label,
}: SortableDragHandleProps) {
  return (
    <button
      type="button"
      className={`touch-none p-2 rounded-lg cursor-grab active:cursor-grabbing transition-colors ${
        darkMode
          ? "text-gray-400 hover:text-white hover:bg-[#374151]"
          : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
      }`}
      aria-label={label}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="w-4 h-4" aria-hidden="true" />
    </button>
  )
}

interface SortableItemShellProps {
  id: string
  children: (props: {
    setNodeRef: (node: HTMLElement | null) => void
    style: CSSProperties
    isDragging: boolean
    attributes: ReturnType<typeof useSortable>["attributes"]
    listeners: ReturnType<typeof useSortable>["listeners"]
  }) => ReactNode
}

export function SortableItemShell({ id, children }: SortableItemShellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.92 : 1,
  }

  return (
    <>
      {children({
        setNodeRef,
        style,
        isDragging,
        attributes,
        listeners,
      })}
    </>
  )
}
