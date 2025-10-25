"use client"

import { useEffect, useRef, useState } from "react"

let modalCount = 0
const BASE_Z_INDEX = 1000

export function useModalManager(isOpen: boolean) {
  const [zIndex, setZIndex] = useState(BASE_Z_INDEX)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      // Store previous focus
      previousFocusRef.current = document.activeElement as HTMLElement

      // Increment modal count and set z-index
      modalCount++
      setZIndex(BASE_Z_INDEX + modalCount * 10)

      // Prevent body scroll
      document.body.style.overflow = "hidden"

      // Focus first focusable element in modal
      setTimeout(() => {
        const focusable = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusable && focusable.length > 0) {
          ;(focusable[0] as HTMLElement).focus()
        }
      }, 100)

      // Trap focus within modal
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Tab" && modalRef.current) {
          const focusable = Array.from(
            modalRef.current.querySelectorAll(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ) as HTMLElement[]

          const firstFocusable = focusable[0]
          const lastFocusable = focusable[focusable.length - 1]

          if (e.shiftKey && document.activeElement === firstFocusable) {
            e.preventDefault()
            lastFocusable.focus()
          } else if (!e.shiftKey && document.activeElement === lastFocusable) {
            e.preventDefault()
            firstFocusable.focus()
          }
        }

        // Close on Escape
        if (e.key === "Escape") {
          e.preventDefault()
        }
      }

      document.addEventListener("keydown", handleKeyDown)

      return () => {
        document.removeEventListener("keydown", handleKeyDown)
        modalCount--

        // Restore body scroll if no modals are open
        if (modalCount === 0) {
          document.body.style.overflow = ""
        }

        // Restore previous focus
        if (previousFocusRef.current) {
          previousFocusRef.current.focus()
        }
      }
    }
  }, [isOpen])

  return { zIndex, modalRef }
}
