"use client"

/**
 * Issue #961 – useSubscriptionClassifier hook
 *
 * Provides per-subscription category classification with:
 * - Async ML-first / rule-based fallback classification
 * - Cached results keyed by service name
 * - User override management persisted to localStorage
 */

import { useState, useEffect, useCallback, useRef } from "react"
import {
  classifySubscription,
  getManualOverride,
  saveCategoryOverride,
  type ClassificationResult,
  type SubscriptionCategory,
  SUBSCRIPTION_CATEGORIES,
} from "@/lib/subscription-classifier"

export type { SubscriptionCategory }
export { SUBSCRIPTION_CATEGORIES }

export interface UseSubscriptionClassifierReturn {
  /** Get the resolved category for a service name (ML → override → rules). */
  getCategory: (serviceName: string) => SubscriptionCategory
  /** True while at least one async classification is in-flight. */
  isClassifying: boolean
  /**
   * Persist a manual category correction for a service name. The correction is
   * immediately reflected in `getCategory` and saved to localStorage.
   */
  overrideCategory: (serviceName: string, category: SubscriptionCategory) => void
  /**
   * The full classification result for a service name, including confidence and
   * whether ML was used. Returns `null` before the first classification completes.
   */
  getResult: (serviceName: string) => ClassificationResult | null
}

/**
 * useSubscriptionClassifier
 *
 * @param serviceNames - Array of service names to pre-classify on mount.
 *
 * @example
 * ```tsx
 * const { getCategory, overrideCategory } = useSubscriptionClassifier(
 *   subscriptions.map((s) => s.name)
 * )
 * // In JSX:
 * <span>{getCategory("Netflix")}</span>
 * // Override:
 * <button onClick={() => overrideCategory("Netflix", "education")}>...</button>
 * ```
 */
export function useSubscriptionClassifier(
  serviceNames: string[],
): UseSubscriptionClassifierReturn {
  const [results, setResults] = useState<Record<string, ClassificationResult>>({})
  const [inFlight, setInFlight] = useState(0)
  // Track which names have been classified to avoid redundant requests.
  const classifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unclassified = serviceNames.filter(
      (name) => name && !classifiedRef.current.has(name.toLowerCase().trim()),
    )
    if (unclassified.length === 0) return

    setInFlight((n) => n + unclassified.length)

    for (const name of unclassified) {
      const key = name.toLowerCase().trim()
      classifiedRef.current.add(key)

      classifySubscription(name)
        .then((result) => {
          setResults((prev) => ({ ...prev, [key]: result }))
        })
        .catch(() => {
          // Fallback: mark as "other" with zero confidence.
          setResults((prev) => ({
            ...prev,
            [key]: { category: "other", confidence: 0, fromML: false },
          }))
        })
        .finally(() => {
          setInFlight((n) => n - 1)
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceNames.join(",")])

  const getCategory = useCallback(
    (serviceName: string): SubscriptionCategory => {
      // Manual override always wins.
      const override = getManualOverride(serviceName)
      if (override) return override

      const key = serviceName.toLowerCase().trim()
      return results[key]?.category ?? "other"
    },
    [results],
  )

  const getResult = useCallback(
    (serviceName: string): ClassificationResult | null => {
      const key = serviceName.toLowerCase().trim()
      return results[key] ?? null
    },
    [results],
  )

  const overrideCategory = useCallback(
    (serviceName: string, category: SubscriptionCategory) => {
      saveCategoryOverride(serviceName, category)
      // Reflect immediately in the results cache so the UI updates without
      // requiring a re-classification.
      const key = serviceName.toLowerCase().trim()
      setResults((prev) => ({
        ...prev,
        [key]: { category, confidence: 1.0, fromML: false },
      }))
    },
    [],
  )

  return {
    getCategory,
    isClassifying: inFlight > 0,
    overrideCategory,
    getResult,
  }
}
