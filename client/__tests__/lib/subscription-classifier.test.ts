import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  classifyByRules,
  classifySubscription,
  saveCategoryOverride,
  loadCategoryOverrides,
  getManualOverride,
  type SubscriptionCategory,
} from '@/lib/subscription-classifier'

/**
 * Issue #961 – Subscription category auto-detection with ML classification
 * Test suite for the classifier module
 */

describe('subscription-classifier', () => {
  describe('classifyByRules', () => {
    it('should classify Netflix as entertainment', () => {
      const result = classifyByRules('Netflix')
      expect(result).toBe('entertainment')
    })

    it('should classify Spotify Premium as entertainment', () => {
      const result = classifyByRules('Spotify Premium')
      expect(result).toBe('entertainment')
    })

    it('should classify Notion as productivity', () => {
      const result = classifyByRules('Notion')
      expect(result).toBe('productivity')
    })

    it('should classify Asana as productivity', () => {
      const result = classifyByRules('Asana')
      expect(result).toBe('productivity')
    })

    it('should classify GitHub as developer tools', () => {
      const result = classifyByRules('GitHub Copilot')
      expect(result).toBe('developer tools')
    })

    it('should classify Slack as communication', () => {
      const result = classifyByRules('Slack')
      expect(result).toBe('communication')
    })

    it('should classify Zoom as communication', () => {
      const result = classifyByRules('Zoom')
      expect(result).toBe('communication')
    })

    it('should classify Duolingo as education', () => {
      const result = classifyByRules('Duolingo')
      expect(result).toBe('education')
    })

    it('should classify Coursera as education', () => {
      const result = classifyByRules('Coursera')
      expect(result).toBe('education')
    })

    it('should classify Peloton as health & fitness', () => {
      const result = classifyByRules('Peloton')
      expect(result).toBe('health & fitness')
    })

    it('should classify Xbox as gaming', () => {
      const result = classifyByRules('Xbox Game Pass')
      expect(result).toBe('gaming')
    })

    it('should classify QuickBooks as finance', () => {
      const result = classifyByRules('QuickBooks')
      expect(result).toBe('finance')
    })

    it('should classify 1Password as security', () => {
      const result = classifyByRules('1Password')
      expect(result).toBe('security')
    })

    it('should classify LastPass as security', () => {
      const result = classifyByRules('LastPass')
      expect(result).toBe('security')
    })

    it('should classify NordVPN as security', () => {
      const result = classifyByRules('NordVPN')
      expect(result).toBe('security')
    })

    it('should classify Dropbox as cloud & storage', () => {
      const result = classifyByRules('Dropbox')
      expect(result).toBe('cloud & storage')
    })

    it('should classify Google One as cloud & storage', () => {
      const result = classifyByRules('Google One')
      expect(result).toBe('cloud & storage')
    })

    it('should classify New York Times as news & media', () => {
      const result = classifyByRules('New York Times')
      expect(result).toBe('news & media')
    })

    it('should classify unknown service as other', () => {
      const result = classifyByRules('Some Random Service XYZ')
      expect(result).toBe('other')
    })

    it('should be case-insensitive', () => {
      const result1 = classifyByRules('netflix')
      const result2 = classifyByRules('NETFLIX')
      const result3 = classifyByRules('Netflix')
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })
  })

  describe('classifySubscription', () => {
    it('should return classification result with confidence', async () => {
      const result = await classifySubscription('Netflix')
      expect(result).toHaveProperty('category')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('fromML')
      expect(result.category).toBe('entertainment')
      expect(typeof result.confidence).toBe('number')
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it('should fall back to rules when no ML model is registered', async () => {
      const result = await classifySubscription('Notion')
      expect(result.category).toBe('productivity')
      expect(result.fromML).toBe(false)
    })

    it('should trim and lowercase input', async () => {
      const result1 = await classifySubscription('  NETFLIX  ')
      const result2 = await classifySubscription('Netflix')
      expect(result1.category).toBe(result2.category)
    })
  })

  describe('Category overrides (localStorage)', () => {
    beforeEach(() => {
      // Clear localStorage before each test
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.clear()
      }
    })

    it('should save and load category overrides', () => {
      const override: SubscriptionCategory = 'education'
      saveCategoryOverride('MyService', override)
      const loaded = getManualOverride('MyService')
      expect(loaded).toBe(override)
    })

    it('should persist multiple overrides', () => {
      saveCategoryOverride('Service1', 'entertainment')
      saveCategoryOverride('Service2', 'productivity')
      const all = loadCategoryOverrides()
      expect(all['service1']).toBe('entertainment')
      expect(all['service2']).toBe('productivity')
    })

    it('should be case-insensitive for service names', () => {
      saveCategoryOverride('MyService', 'finance')
      const override1 = getManualOverride('myservice')
      const override2 = getManualOverride('MYSERVICE')
      const override3 = getManualOverride('MyService')
      expect(override1).toBe('finance')
      expect(override2).toBe('finance')
      expect(override3).toBe('finance')
    })

    it('should return undefined for non-existent overrides', () => {
      const override = getManualOverride('NonExistent')
      expect(override).toBeUndefined()
    })

    it('should overwrite existing overrides', () => {
      saveCategoryOverride('Service', 'entertainment')
      saveCategoryOverride('Service', 'productivity')
      const loaded = getManualOverride('Service')
      expect(loaded).toBe('productivity')
    })
  })
})
