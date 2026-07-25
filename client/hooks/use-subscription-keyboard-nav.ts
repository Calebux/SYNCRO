"use client"

/**
 * Issue #956 – Keyboard-navigable subscription management
 *
 * Provides arrow-key navigation across a list of subscription card refs,
 * exposes focus helpers for managing modal open/close cycles, and offers a
 * lightweight announce() utility to write into an aria-live region.
 */

import { useCallback, useRef } from "react"

export interface UseSubscriptionKeyboardNavReturn {
  /** Register a card element at a given index. Pass `null` to unregister. */
  registerCard: (index: number, el: HTMLElement | null) => void
  /** Handle keydown events on the subscription list container. */
  handleListKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
  /**
   * Call before opening a modal. Captures the element that triggered the
   * open action so focus can be returned when the modal closes.
   */
  captureTriggerFocus: (trigger: HTMLElement | null) => void
  /** Restore focus to the previously captured trigger element. */
  restoreTriggerFocus: () => void
  /** Announce a message via the connected aria-live region. */
  announce: (message: string) => void
  /** Ref to attach to the aria-live region div. */
  liveRegionRef: React.RefObject<HTMLDivElement | null>
}

/**
 * useSubscriptionKeyboardNav
 *
 * Manages roving-tabindex-style arrow-key navigation for subscription cards
 * and exposes helpers for accessible modal lifecycle management.
 *
 * Usage:
 * ```tsx
 * const { registerCard, handleListKeyDown, ... } = useSubscriptionKeyboardNav()
 *
 * <div onKeyDown={handleListKeyDown}>
 *   {cards.map((card, i) => (
 *     <SubscriptionCard ref={(el) => registerCard(i, el)} ... />
 *   ))}
 * </div>
 * <div role="status" aria-live="polite" aria-atomic="true" ref={liveRegionRef} className="sr-only" />
 * ```
 */
export function useSubscriptionKeyboardNav(): UseSubscriptionKeyboardNavReturn {
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const triggerRef = useRef<HTMLElement | null>(null)
  const liveRegionRef = useRef<HTMLDivElement | null>(null)

  const registerCard = useCallback((index: number, el: HTMLElement | null) => {
    cardRefs.current[index] = el
  }, [])

  /** Move focus to a card by index, clamping to valid bounds. */
  const focusCard = useCallback((index: number) => {
    const cards = cardRefs.current.filter(Boolean) as HTMLElement[]
    const clamped = Math.max(0, Math.min(index, cards.length - 1))
    const target = cardRefs.current[clamped]
    if (target) {
      target.focus()
    }
  }, [])

  /** Resolve the index of the currently focused card. Returns -1 if none. */
  const currentFocusIndex = useCallback((): number => {
    return cardRefs.current.findIndex(
      (el) => el !== null && el === document.activeElement,
    )
  }, [])

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const idx = currentFocusIndex()
      if (idx === -1) return

      const cards = cardRefs.current.filter(Boolean) as HTMLElement[]
      const count = cards.length

      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight": {
          e.preventDefault()
          const next = (idx + 1) % count
          focusCard(next)
          break
        }
        case "ArrowUp":
        case "ArrowLeft": {
          e.preventDefault()
          const prev = (idx - 1 + count) % count
          focusCard(prev)
          break
        }
        case "Home": {
          e.preventDefault()
          focusCard(0)
          break
        }
        case "End": {
          e.preventDefault()
          focusCard(count - 1)
          break
        }
        // Enter and Space are handled natively by <button> elements within
        // each card, so no additional handling is required here.
        default:
          break
      }
    },
    [currentFocusIndex, focusCard],
  )

  const captureTriggerFocus = useCallback((trigger: HTMLElement | null) => {
    triggerRef.current = trigger
  }, [])

  const restoreTriggerFocus = useCallback(() => {
    triggerRef.current?.focus()
    triggerRef.current = null
  }, [])

  const announce = useCallback((message: string) => {
    if (!liveRegionRef.current) return
    // Clear then set to guarantee the screen reader re-reads the content even
    // if the message text is identical to the previous announcement.
    liveRegionRef.current.textContent = ""
    // Defer to next tick so screen readers register the change.
    requestAnimationFrame(() => {
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = message
      }
    })
  }, [])

  return {
    registerCard,
    handleListKeyDown,
    captureTriggerFocus,
    restoreTriggerFocus,
    announce,
    liveRegionRef,
  }
}
