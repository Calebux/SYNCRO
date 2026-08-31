import { describe, it, expect } from 'vitest'

// These are pure functions exported from the check script
// We import them via dynamic require since the script is CommonJS
const script = require('../../scripts/check-bundle-size.js')

describe('check-bundle-size', () => {
  describe('routeToChunkPrefix', () => {
    it('should map root route to app/page prefix', () => {
      expect(script.routeToChunkPrefix('/')).toBe('app/page')
    })

    it('should map nested routes to app/dir/page prefix', () => {
      expect(script.routeToChunkPrefix('/dashboard')).toBe('app/dashboard/page')
    })

    it('should map deeply nested routes', () => {
      expect(script.routeToChunkPrefix('/dashboard/analytics')).toBe('app/dashboard/analytics/page')
    })

    it('should strip trailing slash', () => {
      expect(script.routeToChunkPrefix('/settings/')).toBe('app/settings/page')
    })

    it('should handle routes with hyphens', () => {
      expect(script.routeToChunkPrefix('/email-preferences')).toBe('app/email-preferences/page')
    })

    it('should handle oauth routes', () => {
      expect(script.routeToChunkPrefix('/oauth-success')).toBe('app/oauth-success/page')
    })
  })

  describe('formatKB', () => {
    it('should convert bytes to KB with one decimal', () => {
      expect(script.formatKB(1024)).toBe('1.0')
    })

    it('should handle zero', () => {
      expect(script.formatKB(0)).toBe('0.0')
    })

    it('should handle large values', () => {
      expect(script.formatKB(1048576)).toBe('1024.0')
    })

    it('should round to one decimal', () => {
      expect(script.formatKB(1536)).toBe('1.5')
    })
  })

  describe('checkBudgets', () => {
    const baseBudgets = {
      total: 800,
      shared: 400,
      perRoute: {
        '/': 350,
        '/dashboard': 350,
        '/settings': 250,
      },
      perChunk: 200,
    }

    it('should pass when all sizes are within budgets', () => {
      const measurement = {
        totalChunkSize: 500 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 200 * 1024 }],
        routes: {
          '/': { totalSize: 250 * 1024, routeSize: 50 * 1024, sharedSize: 200 * 1024, gzipSize: 80 * 1024, chunks: [] },
          '/dashboard': { totalSize: 300 * 1024, routeSize: 100 * 1024, sharedSize: 200 * 1024, gzipSize: 100 * 1024, chunks: [] },
          '/settings': { totalSize: 200 * 1024, routeSize: 50 * 1024, sharedSize: 150 * 1024, gzipSize: 65 * 1024, chunks: [] },
        },
        allChunks: [
          { name: 'framework.js', size: 200 * 1024 },
          { name: 'app-page.js', size: 50 * 1024 },
        ],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      expect(result.violations).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })

    it('should fail when total JS exceeds budget', () => {
      const measurement = {
        totalChunkSize: 900 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 400 * 1024 }],
        routes: {
          '/': { totalSize: 500 * 1024, routeSize: 100 * 1024, sharedSize: 400 * 1024, gzipSize: 160 * 1024, chunks: [] },
        },
        allChunks: [{ name: 'framework.js', size: 400 * 1024 }],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      expect(result.violations.some(v => v.type === 'total')).toBe(true)
    })

    it('should fail when shared chunk size exceeds budget', () => {
      const measurement = {
        totalChunkSize: 500 * 1024,
        sharedChunks: [{ name: 'vendor.js', size: 450 * 1024 }],
        routes: {
          '/': { totalSize: 500 * 1024, routeSize: 50 * 1024, sharedSize: 450 * 1024, gzipSize: 160 * 1024, chunks: [] },
        },
        allChunks: [{ name: 'vendor.js', size: 450 * 1024 }],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      expect(result.violations.some(v => v.type === 'shared')).toBe(true)
    })

    it('should fail when a specific route exceeds its budget', () => {
      const measurement = {
        totalChunkSize: 500 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 100 * 1024 }],
        routes: {
          '/': { totalSize: 400 * 1024, routeSize: 300 * 1024, sharedSize: 100 * 1024, gzipSize: 130 * 1024, chunks: [] },
          '/dashboard': { totalSize: 200 * 1024, routeSize: 100 * 1024, sharedSize: 100 * 1024, gzipSize: 65 * 1024, chunks: [] },
        },
        allChunks: [{ name: 'framework.js', size: 100 * 1024 }],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      const routeViolation = result.violations.find(v => v.type === 'route' && v.route === '/')
      expect(routeViolation).toBeDefined()
      expect(routeViolation!.actual).toBe('400.0')
      expect(routeViolation!.budget).toBe(350)
    })

    it('should warn when a route is approaching its budget (over 90%)', () => {
      const measurement = {
        totalChunkSize: 400 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 100 * 1024 }],
        routes: {
          '/dashboard': { totalSize: 325 * 1024, routeSize: 225 * 1024, sharedSize: 100 * 1024, gzipSize: 105 * 1024, chunks: [] },
        },
        allChunks: [{ name: 'framework.js', size: 100 * 1024 }],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      const routeWarning = result.warnings.find(w => w.type === 'route' && w.route === '/dashboard')
      expect(routeWarning).toBeDefined()
      // 325 KB / 350 KB = 92.8%, should trigger warning at >90%
      // 325 KB / 350 KB = 92.8%, should trigger warning at >90%
      expect(routeWarning!.actual).toBe('325.0')
    })

    it('should fail when an individual chunk exceeds perChunk budget', () => {
      const measurement = {
        totalChunkSize: 300 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 100 * 1024 }],
        routes: {
          '/': { totalSize: 300 * 1024, routeSize: 200 * 1024, sharedSize: 100 * 1024, gzipSize: 100 * 1024, chunks: [] },
        },
        allChunks: [
          { name: 'framework.js', size: 100 * 1024 },
          { name: 'huge-chunk.js', size: 250 * 1024 },
        ],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      const chunkViolation = result.violations.find(v => v.type === 'chunk')
      expect(chunkViolation).toBeDefined()
      expect(chunkViolation!.chunk).toBe('huge-chunk.js')
    })

    it('should report multiple violations', () => {
      const measurement = {
        totalChunkSize: 900 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 500 * 1024 }],
        routes: {
          '/': { totalSize: 600 * 1024, routeSize: 100 * 1024, sharedSize: 500 * 1024, gzipSize: 200 * 1024, chunks: [] },
          '/dashboard': { totalSize: 550 * 1024, routeSize: 50 * 1024, sharedSize: 500 * 1024, gzipSize: 180 * 1024, chunks: [] },
        },
        allChunks: [
          { name: 'framework.js', size: 500 * 1024 },
        ],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      expect(result.violations.length).toBeGreaterThanOrEqual(2)
    })

    it('should not fail for routes not in the budget config', () => {
      const measurement = {
        totalChunkSize: 100 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 50 * 1024 }],
        routes: {
          '/': { totalSize: 100 * 1024, routeSize: 50 * 1024, sharedSize: 50 * 1024, gzipSize: 33 * 1024, chunks: [] },
          '/unknown-route': { totalSize: 999 * 1024, routeSize: 949 * 1024, sharedSize: 50 * 1024, gzipSize: 330 * 1024, chunks: [] },
        },
        allChunks: [{ name: 'framework.js', size: 50 * 1024 }],
      }

      const result = script.checkBudgets(measurement, baseBudgets)
      // No violation should be reported for /unknown-route since it's not in budget config
      const unknownViolation = result.violations.find(v => v.route === '/unknown-route')
      expect(unknownViolation).toBeUndefined()
    })

    it('should return empty violations and warnings for perfectly efficient build', () => {
      const tinyMeasurement = {
        totalChunkSize: 100 * 1024,
        sharedChunks: [{ name: 'framework.js', size: 50 * 1024 }],
        routes: {
          '/': { totalSize: 80 * 1024, routeSize: 30 * 1024, sharedSize: 50 * 1024, gzipSize: 25 * 1024, chunks: [] },
          '/dashboard': { totalSize: 70 * 1024, routeSize: 20 * 1024, sharedSize: 50 * 1024, gzipSize: 22 * 1024, chunks: [] },
        },
        allChunks: [{ name: 'framework.js', size: 50 * 1024 }],
      }

      const result = script.checkBudgets(tinyMeasurement, baseBudgets)
      expect(result.violations).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })
  })
})
