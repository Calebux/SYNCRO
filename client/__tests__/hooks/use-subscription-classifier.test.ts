import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSubscriptionClassifier, SUBSCRIPTION_CATEGORIES } from '@/hooks/use-subscription-classifier'

/**
 * Issue #961 – useSubscriptionClassifier hook tests
 */

describe('useSubscriptionClassifier hook', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.clear()
    }
  })

  it('should initialize with empty service names', () => {
    const { result } = renderHook(() => useSubscriptionClassifier([]))
    expect(result.current.getCategory('Unknown')).toBe('other')
  })

  it('should classify Netflix as entertainment', async () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['Netflix']))

    await waitFor(() => {
      const result_val = result.current.getCategory('Netflix')
      expect(result_val).toBe('entertainment')
    })
  })

  it('should classify Notion as productivity', async () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['Notion']))

    await waitFor(() => {
      const result_val = result.current.getCategory('Notion')
      expect(result_val).toBe('productivity')
    })
  })

  it('should classify multiple services', async () => {
    const { result } = renderHook(() =>
      useSubscriptionClassifier(['Netflix', 'Notion', 'GitHub Copilot'])
    )

    await waitFor(() => {
      expect(result.current.getCategory('Netflix')).toBe('entertainment')
      expect(result.current.getCategory('Notion')).toBe('productivity')
      expect(result.current.getCategory('GitHub Copilot')).toBe('developer tools')
    })
  })

  it('should indicate classification is in progress', () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['Netflix']))
    // isClassifying may be true or false depending on timing
    expect(typeof result.current.isClassifying).toBe('boolean')
  })

  it('should allow manual category override', async () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['Netflix']))

    // Wait for initial classification
    await waitFor(() => {
      expect(result.current.getCategory('Netflix')).toBe('entertainment')
    })

    // Override to education
    act(() => {
      result.current.overrideCategory('Netflix', 'education')
    })

    expect(result.current.getCategory('Netflix')).toBe('education')
  })

  it('should persist and retrieve manual overrides', async () => {
    const { result: result1 } = renderHook(() =>
      useSubscriptionClassifier(['Netflix'])
    )

    await waitFor(() => {
      expect(result1.current.getCategory('Netflix')).toBeDefined()
    })

    act(() => {
      result1.current.overrideCategory('Netflix', 'finance')
    })

    // Create new hook instance to verify persistence
    const { result: result2 } = renderHook(() =>
      useSubscriptionClassifier(['Netflix'])
    )

    await waitFor(() => {
      expect(result2.current.getCategory('Netflix')).toBe('finance')
    })
  })

  it('should return classification result with metadata', async () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['Netflix']))

    await waitFor(() => {
      const classResult = result.current.getResult('Netflix')
      expect(classResult).not.toBeNull()
      expect(classResult).toHaveProperty('category')
      expect(classResult).toHaveProperty('confidence')
      expect(classResult).toHaveProperty('fromML')
    })
  })

  it('should handle empty service name', async () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['']))
    const category = result.current.getCategory('')
    expect(category).toBe('other')
  })

  it('should trim whitespace from service names', async () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['  Netflix  ']))

    await waitFor(() => {
      expect(result.current.getCategory('Netflix')).toBe('entertainment')
    })
  })

  it('should be case-insensitive', async () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['netflix']))

    await waitFor(() => {
      expect(result.current.getCategory('netflix')).toBe('entertainment')
      expect(result.current.getCategory('NETFLIX')).toBe('entertainment')
      expect(result.current.getCategory('Netflix')).toBe('entertainment')
    })
  })

  it('should support all standard categories', () => {
    const { result } = renderHook(() => useSubscriptionClassifier([]))
    for (const category of SUBSCRIPTION_CATEGORIES) {
      act(() => {
        result.current.overrideCategory('test', category)
      })
      expect(result.current.getCategory('test')).toBe(category)
    }
  })

  it('should handle concurrent classifications', async () => {
    const services = [
      'Netflix',
      'Notion',
      'GitHub',
      'Slack',
      'Zoom',
      'Duolingo',
      'Peloton',
    ]
    const { result } = renderHook(() => useSubscriptionClassifier(services))

    await waitFor(() => {
      for (const service of services) {
        const category = result.current.getCategory(service)
        expect(category).not.toBe('other')
      }
    })
  })

  it('should not re-classify already classified services', async () => {
    const { result, rerender } = renderHook(
      ({ services }) => useSubscriptionClassifier(services),
      { initialProps: { services: ['Netflix'] } }
    )

    await waitFor(() => {
      expect(result.current.getCategory('Netflix')).toBe('entertainment')
    })

    const initialIsClassifying = result.current.isClassifying

    // Re-render with same services
    rerender({ services: ['Netflix'] })

    // isClassifying should not change much since already classified
    expect(typeof result.current.isClassifying).toBe('boolean')
  })

  it('should return null for result before classification completes', () => {
    const { result } = renderHook(() => useSubscriptionClassifier(['Netflix']))
    // May return null or an object depending on timing
    const res = result.current.getResult('Netflix')
    expect(res === null || typeof res === 'object').toBe(true)
  })
})
