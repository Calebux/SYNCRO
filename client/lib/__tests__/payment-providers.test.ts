import { describe, it, expect } from "vitest"
import {
  getProvidersForRegion,
  isProviderValidForRegion,
  getCurrencyForRegion,
  PROVIDER_MATRIX,
  type Region,
} from "../payment-providers"

describe("Payment Provider Matrix", () => {

  describe("getProvidersForRegion", () => {
    it("NG production → only paystack", () => {
      expect(getProvidersForRegion('NG', 'production')).toEqual(['paystack'])
    })

    it("GH production → only paystack", () => {
      expect(getProvidersForRegion('GH', 'production')).toEqual(['paystack'])
    })

    it("ZA production → only paystack", () => {
      expect(getProvidersForRegion('ZA', 'production')).toEqual(['paystack'])
    })

    it("KE production → only paystack", () => {
      expect(getProvidersForRegion('KE', 'production')).toEqual(['paystack'])
    })

    it("INTL production → only paypal", () => {
      expect(getProvidersForRegion('INTL', 'production')).toEqual(['paypal'])
    })

    it("NG development → paystack and mock", () => {
      const providers = getProvidersForRegion('NG', 'development')
      expect(providers).toContain('paystack')
      expect(providers).toContain('mock')
      expect(providers).not.toContain('paypal')
    })

    it("INTL development → paypal and mock", () => {
      const providers = getProvidersForRegion('INTL', 'development')
      expect(providers).toContain('paypal')
      expect(providers).toContain('mock')
      expect(providers).not.toContain('paystack')
    })
  })

  describe("isProviderValidForRegion", () => {
    it("mock is never valid in production for any region", () => {
      const allRegions: Region[] = ['NG', 'GH', 'ZA', 'KE', 'INTL']
      for (const region of allRegions) {
        expect(isProviderValidForRegion('mock', region, 'production')).toBe(false)
      }
    })

    it("paypal is not valid for African regions in production", () => {
      expect(isProviderValidForRegion('paypal', 'NG', 'production')).toBe(false)
      expect(isProviderValidForRegion('paypal', 'GH', 'production')).toBe(false)
      expect(isProviderValidForRegion('paypal', 'ZA', 'production')).toBe(false)
      expect(isProviderValidForRegion('paypal', 'KE', 'production')).toBe(false)
    })

    it("paystack is not valid for INTL in any environment", () => {
      expect(isProviderValidForRegion('paystack', 'INTL', 'production')).toBe(false)
      expect(isProviderValidForRegion('paystack', 'INTL', 'development')).toBe(false)
      expect(isProviderValidForRegion('paystack', 'INTL', 'test')).toBe(false)
    })

    it("paystack is valid for all African regions in production", () => {
      expect(isProviderValidForRegion('paystack', 'NG', 'production')).toBe(true)
      expect(isProviderValidForRegion('paystack', 'GH', 'production')).toBe(true)
      expect(isProviderValidForRegion('paystack', 'ZA', 'production')).toBe(true)
      expect(isProviderValidForRegion('paystack', 'KE', 'production')).toBe(true)
    })

    it("paypal is valid for INTL in production", () => {
      expect(isProviderValidForRegion('paypal', 'INTL', 'production')).toBe(true)
    })
  })

  describe("getCurrencyForRegion", () => {
    it("returns NGN for African regions", () => {
      expect(getCurrencyForRegion('NG')).toBe('NGN')
      expect(getCurrencyForRegion('GH')).toBe('NGN')
      expect(getCurrencyForRegion('ZA')).toBe('NGN')
      expect(getCurrencyForRegion('KE')).toBe('NGN')
    })

    it("returns USD for international", () => {
      expect(getCurrencyForRegion('INTL')).toBe('USD')
    })
  })

  describe("PROVIDER_MATRIX integrity", () => {
    it("every rule has at least one region and one environment", () => {
      for (const rule of PROVIDER_MATRIX) {
        expect(rule.regions.length).toBeGreaterThan(0)
        expect(rule.environments.length).toBeGreaterThan(0)
      }
    })

    it("mock never appears in production environments", () => {
      const mockRule = PROVIDER_MATRIX.find((r) => r.provider === 'mock')
      expect(mockRule).toBeDefined()
      expect(mockRule!.environments).not.toContain('production')
    })

    it("paystack and paypal never share a region", () => {
      const paystackRegions = PROVIDER_MATRIX
        .find((r) => r.provider === 'paystack')!.regions
      const paypalRegions = PROVIDER_MATRIX
        .find((r) => r.provider === 'paypal')!.regions

      const overlap = paystackRegions.filter((r) => paypalRegions.includes(r))
      expect(overlap).toHaveLength(0)
    })
  })
})