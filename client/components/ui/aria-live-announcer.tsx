"use client"

/**
 * Issue #956 – AriaLiveAnnouncer
 *
 * A singleton component that renders two ARIA live regions (polite + assertive)
 * for screen-reader announcements. Import and place once at the app root, then
 * call the exported `announce` helpers from anywhere in the component tree.
 */

import { useEffect, useRef } from "react"

// ── Module-level singleton refs ────────────────────────────────────────────────
// These are populated once the component mounts so that announce() can be
// called from outside the React tree (e.g. hooks, utils).
let politeEl: HTMLElement | null = null
let assertiveEl: HTMLElement | null = null

function writeToRegion(el: HTMLElement | null, message: string): void {
  if (!el) return
  // Reset first so identical messages still re-trigger screen readers.
  el.textContent = ""
  requestAnimationFrame(() => {
    if (el) el.textContent = message
  })
}

/**
 * Announce a non-urgent message. Screen readers will finish the current
 * sentence before reading it.
 */
export function announcePolite(message: string): void {
  writeToRegion(politeEl, message)
}

/**
 * Announce an urgent message immediately, interrupting the current speech.
 */
export function announceAssertive(message: string): void {
  writeToRegion(assertiveEl, message)
}

interface AriaLiveAnnouncerProps {
  /** Optional class applied to the wrapper span. Defaults to sr-only styles. */
  className?: string
}

/**
 * AriaLiveAnnouncer
 *
 * Render once at the application root (e.g. in your root layout or a
 * top-level provider component):
 *
 * ```tsx
 * <AriaLiveAnnouncer />
 * ```
 *
 * Then, anywhere in the codebase:
 * ```ts
 * import { announcePolite } from "@/components/ui/aria-live-announcer"
 * announcePolite("Subscription paused.")
 * ```
 */
export function AriaLiveAnnouncer({ className }: AriaLiveAnnouncerProps) {
  const politeRef = useRef<HTMLSpanElement>(null)
  const assertiveRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    politeEl = politeRef.current
    assertiveEl = assertiveRef.current
    return () => {
      politeEl = null
      assertiveEl = null
    }
  }, [])

  const srOnly =
    className ??
    "absolute w-px h-px p-0 -m-px overflow-hidden clip-rect-0 whitespace-nowrap border-0"

  return (
    <>
      <span
        ref={politeRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={srOnly}
      />
      <span
        ref={assertiveRef}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className={srOnly}
      />
    </>
  )
}
