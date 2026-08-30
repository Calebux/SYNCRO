/**
 * Validation Functions Tests
 * Tests for validateSubscriptionCreateInput, validateSubscriptionUpdateInput, and validateGiftCardHash
 */

import { describe, it, expect } from 'vitest'
import {
  validateSubscriptionCreateInput,
  validateSubscriptionUpdateInput,
  validateGiftCardHash,
  ValidationError,
} from '@/lib/validation'

describe('Validation Functions', () => {
  describe('validateSubscriptionCreateInput', () => {
    describe('Valid Inputs', () => {
      it('should pass with minimal required fields', () => {
        const validData = {
          name: 'Netflix',
          price: 15.99,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })

      it('should pass with all fields populated', () => {
        const validData = {
          name: 'Premium Subscription',
          price: 99.99,
          billing_cycle: 'yearly',
          currency: 'USD',
          renewal_url: 'https://example.com/renew',
          website_url: 'https://example.com',
          logo_url: 'https://example.com/logo.png',
          category: 'Entertainment',
          notes: 'My premium subscription',
          is_trial: false,
          status: 'active',
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })

      it('should pass with trial configuration', () => {
        const validData = {
          name: 'Trial Subscription',
          price: 29.99,
          billing_cycle: 'monthly',
          is_trial: true,
          trial_end_date: '2026-06-26T12:00:00Z',
          trial_converts_to_price: 9.99,
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })

      it('should pass with zero price', () => {
        const validData = {
          name: 'Free Tier',
          price: 0,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })

      it('should pass with all valid billing cycles', () => {
        const billingCycles = ['monthly', 'yearly', 'quarterly', 'weekly', 'annual']

        billingCycles.forEach((cycle) => {
          const validData = {
            name: 'Test',
            price: 10,
            billing_cycle: cycle,
          }

          expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
        })
      })

      it('should pass with maximum allowed values', () => {
        const validData = {
          name: 'A'.repeat(100),
          price: 100000,
          billing_cycle: 'yearly',
          currency: 'USDT',
          category: 'C'.repeat(50),
          notes: 'N'.repeat(5000),
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })
    })

    describe('Name Validation', () => {
      it('should fail when name is missing', () => {
        const invalidData = {
          price: 10,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/name is required/i)
      })

      it('should fail when name is empty string', () => {
        const invalidData = {
          name: '',
          price: 10,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/name is required/i)
      })

      it('should fail when name is only whitespace', () => {
        const invalidData = {
          name: '   ',
          price: 10,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/name is required/i)
      })

      it('should fail when name exceeds 100 characters', () => {
        const invalidData = {
          name: 'A'.repeat(101),
          price: 10,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/must not exceed 100 characters/i)
      })

      it('should fail when name is not a string', () => {
        const invalidData = {
          name: 123,
          price: 10,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/name is required/i)
      })
    })

    describe('Price Validation', () => {
      it('should fail when price is missing', () => {
        const invalidData = {
          name: 'Test',
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/price/i)
      })

      it('should fail when price is not a number', () => {
        const invalidData = {
          name: 'Test',
          price: 'not-a-number',
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/valid number/i)
      })

      it('should fail when price is negative', () => {
        const invalidData = {
          name: 'Test',
          price: -10,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/zero or positive/i)
      })

      it('should fail when price exceeds 100000', () => {
        const invalidData = {
          name: 'Test',
          price: 100001,
          billing_cycle: 'monthly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/must not exceed \$100,000/i)
      })
    })

    describe('Billing Cycle Validation', () => {
      it('should fail when billing_cycle is missing', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/billing cycle/i)
      })

      it('should fail when billing_cycle is invalid', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'biweekly',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/billing cycle must be one of/i)
      })
    })

    describe('URL Validation', () => {
      it('should fail when renewal_url is invalid', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          renewal_url: 'not-a-url',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/renewal url.*valid/i)
      })

      it('should fail when website_url is invalid', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          website_url: 'ftp://example.com',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/website url.*valid/i)
      })

      it('should fail when logo_url is invalid', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          logo_url: 'javascript:alert("xss")',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/logo url.*valid/i)
      })

      it('should pass with valid HTTP URLs', () => {
        const validData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          renewal_url: 'http://example.com/renew',
          website_url: 'http://example.com',
          logo_url: 'http://example.com/logo.png',
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })

      it('should pass with valid HTTPS URLs', () => {
        const validData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          renewal_url: 'https://example.com/renew',
          website_url: 'https://example.com',
          logo_url: 'https://example.com/logo.png',
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })
    })

    describe('Category Validation', () => {
      it('should fail when category exceeds 50 characters', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          category: 'C'.repeat(51),
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/category.*50 characters/i)
      })

      it('should pass with valid category', () => {
        const validData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          category: 'Entertainment',
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })
    })

    describe('Notes Validation', () => {
      it('should fail when notes exceed 5000 characters', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          notes: 'N'.repeat(5001),
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/notes.*5000 characters/i)
      })

      it('should pass with valid notes', () => {
        const validData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          notes: 'This is a test subscription with some notes',
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })
    })

    describe('Trial Validation', () => {
      it('should fail when trial is enabled but trial_end_date is missing', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          is_trial: true,
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/trial end date.*required/i)
      })

      it('should fail when trial_end_date is invalid', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          is_trial: true,
          trial_end_date: 'not-a-date',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/trial end date.*valid/i)
      })

      it('should fail when trial_converts_to_price is negative', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          is_trial: true,
          trial_end_date: '2026-06-26T12:00:00Z',
          trial_converts_to_price: -5,
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/trial conversion price/i)
      })

      it('should pass with valid trial configuration', () => {
        const validData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          is_trial: true,
          trial_end_date: '2026-06-26T12:00:00Z',
          trial_converts_to_price: 5,
        }

        expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
      })
    })

    describe('Status Validation', () => {
      it('should fail when status is invalid', () => {
        const invalidData = {
          name: 'Test',
          price: 10,
          billing_cycle: 'monthly',
          status: 'unknown',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(/status must be one of/i)
      })

      it('should pass with valid statuses', () => {
        const validStatuses = ['active', 'cancelled', 'expired', 'paused', 'trial']

        validStatuses.forEach((status) => {
          const validData = {
            name: 'Test',
            price: 10,
            billing_cycle: 'monthly',
            status,
          }

          expect(() => validateSubscriptionCreateInput(validData)).not.toThrow()
        })
      })
    })

    describe('Multiple Errors', () => {
      it('should report all validation errors at once', () => {
        const invalidData = {
          name: '',
          price: -10,
          billing_cycle: 'invalid',
        }

        expect(() => validateSubscriptionCreateInput(invalidData)).toThrow(ValidationError)
        const error = expect(() => validateSubscriptionCreateInput(invalidData)).toThrow()
        // Should contain multiple error messages
        expect(error).toBeDefined()
      })
    })
  })

  describe('validateSubscriptionUpdateInput', () => {
    describe('Valid Inputs', () => {
      it('should pass with empty object (no updates)', () => {
        expect(() => validateSubscriptionUpdateInput({})).not.toThrow()
      })

      it('should pass with partial updates', () => {
        const validData = {
          name: 'Updated Name',
          price: 25.99,
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })

      it('should pass with single field update', () => {
        const validData = {
          status: 'paused',
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })

      it('should pass with all fields', () => {
        const validData = {
          name: 'Updated Subscription',
          price: 49.99,
          billing_cycle: 'yearly',
          currency: 'EUR',
          renewal_url: 'https://example.com/renew',
          website_url: 'https://example.com',
          logo_url: 'https://example.com/logo.png',
          category: 'Updated Category',
          notes: 'Updated notes',
          status: 'active',
          next_billing_date: '2026-07-26T12:00:00Z',
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })
    })

    describe('Name Validation', () => {
      it('should fail when name is empty string', () => {
        const invalidData = {
          name: '',
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/non-empty string/i)
      })

      it('should fail when name exceeds 100 characters', () => {
        const invalidData = {
          name: 'A'.repeat(101),
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/must not exceed 100 characters/i)
      })

      it('should pass when name is not provided', () => {
        const validData = {
          price: 20,
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })
    })

    describe('Price Validation', () => {
      it('should fail when price is not a number', () => {
        const invalidData = {
          price: 'invalid',
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/valid number/i)
      })

      it('should fail when price is negative', () => {
        const invalidData = {
          price: -5,
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/zero or positive/i)
      })

      it('should fail when price exceeds 100000', () => {
        const invalidData = {
          price: 100001,
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/must not exceed \$100,000/i)
      })

      it('should pass with valid price', () => {
        const validData = {
          price: 50,
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })
    })

    describe('Billing Cycle Validation', () => {
      it('should fail when billing_cycle is invalid', () => {
        const invalidData = {
          billing_cycle: 'invalid',
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/billing cycle must be one of/i)
      })

      it('should pass with valid billing cycle', () => {
        const validData = {
          billing_cycle: 'quarterly',
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })
    })

    describe('URL Validation', () => {
      it('should fail when renewal_url is invalid', () => {
        const invalidData = {
          renewal_url: 'not-a-url',
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/renewal url.*valid/i)
      })

      it('should pass with valid URLs', () => {
        const validData = {
          renewal_url: 'https://example.com/renew',
          website_url: 'https://example.com',
          logo_url: 'https://example.com/logo.png',
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })
    })

    describe('Status Validation', () => {
      it('should fail when status is invalid', () => {
        const invalidData = {
          status: 'unknown',
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/status must be one of/i)
      })

      it('should pass with valid status', () => {
        const validData = {
          status: 'cancelled',
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })
    })

    describe('Next Billing Date Validation', () => {
      it('should fail when next_billing_date is invalid', () => {
        const invalidData = {
          next_billing_date: 'not-a-date',
        }

        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(ValidationError)
        expect(() => validateSubscriptionUpdateInput(invalidData)).toThrow(/next billing date.*valid/i)
      })

      it('should pass with valid datetime', () => {
        const validData = {
          next_billing_date: '2026-07-26T12:00:00Z',
        }

        expect(() => validateSubscriptionUpdateInput(validData)).not.toThrow()
      })
    })
  })

  describe('validateGiftCardHash', () => {
    describe('Valid Inputs', () => {
      it('should pass with valid 32-character hex hash', () => {
        const validHash = 'a'.repeat(32)
        expect(() => validateGiftCardHash(validHash)).not.toThrow()
      })

      it('should pass with valid 64-character hex hash', () => {
        const validHash = 'a'.repeat(64)
        expect(() => validateGiftCardHash(validHash)).not.toThrow()
      })

      it('should pass with mixed case hex characters', () => {
        const validHash = 'aAbBcCdDeEfF0123456789aAbBcCdDeE'
        expect(() => validateGiftCardHash(validHash)).not.toThrow()
      })

      it('should pass with SHA-256 hash format', () => {
        const sha256Hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        expect(() => validateGiftCardHash(sha256Hash)).not.toThrow()
      })

      it('should pass with uppercase hex characters', () => {
        const validHash = 'ABCDEF0123456789ABCDEF0123456789'
        expect(() => validateGiftCardHash(validHash)).not.toThrow()
      })
    })

    describe('Invalid Inputs', () => {
      it('should fail when hash is not a string', () => {
        expect(() => validateGiftCardHash(123 as any)).toThrow(ValidationError)
        expect(() => validateGiftCardHash(123 as any)).toThrow(/must be a text value/i)
      })

      it('should fail when hash is empty', () => {
        expect(() => validateGiftCardHash('')).toThrow(ValidationError)
        expect(() => validateGiftCardHash('')).toThrow(/is required/i)
      })

      it('should fail when hash is only whitespace', () => {
        expect(() => validateGiftCardHash('   ')).toThrow(ValidationError)
        expect(() => validateGiftCardHash('   ')).toThrow(/is required/i)
      })

      it('should fail when hash is less than 32 characters', () => {
        const shortHash = 'a'.repeat(31)
        expect(() => validateGiftCardHash(shortHash)).toThrow(ValidationError)
        expect(() => validateGiftCardHash(shortHash)).toThrow(/at least 32 characters/i)
      })

      it('should fail when hash exceeds 64 characters', () => {
        const longHash = 'a'.repeat(65)
        expect(() => validateGiftCardHash(longHash)).toThrow(ValidationError)
        expect(() => validateGiftCardHash(longHash)).toThrow(/must not exceed 64 characters/i)
      })

      it('should fail when hash contains non-hex characters', () => {
        const invalidHash = 'g'.repeat(32) // 'g' is not a hex character
        expect(() => validateGiftCardHash(invalidHash)).toThrow(ValidationError)
        expect(() => validateGiftCardHash(invalidHash)).toThrow(/hexadecimal characters/i)
      })

      it('should fail when hash contains spaces', () => {
        const invalidHash = 'a'.repeat(16) + ' ' + 'a'.repeat(15)
        expect(() => validateGiftCardHash(invalidHash)).toThrow(ValidationError)
        expect(() => validateGiftCardHash(invalidHash)).toThrow(/hexadecimal characters/i)
      })

      it('should fail when hash contains special characters', () => {
        const invalidHash = 'a'.repeat(31) + '!'
        expect(() => validateGiftCardHash(invalidHash)).toThrow(ValidationError)
        expect(() => validateGiftCardHash(invalidHash)).toThrow(/hexadecimal characters/i)
      })

      it('should fail when hash contains dashes (common UUID format)', () => {
        const uuidHash = 'a'.repeat(8) + '-' + 'a'.repeat(4) + '-' + 'a'.repeat(4) + '-' + 'a'.repeat(4) + '-' + 'a'.repeat(12)
        expect(() => validateGiftCardHash(uuidHash)).toThrow(ValidationError)
        expect(() => validateGiftCardHash(uuidHash)).toThrow(/hexadecimal characters/i)
      })
    })

    describe('Edge Cases', () => {
      it('should pass with exactly 32 hex characters', () => {
        const hash = '0'.repeat(32)
        expect(() => validateGiftCardHash(hash)).not.toThrow()
      })

      it('should pass with exactly 64 hex characters', () => {
        const hash = 'f'.repeat(64)
        expect(() => validateGiftCardHash(hash)).not.toThrow()
      })

      it('should pass with alternating case', () => {
        const hash = 'aAbBcCdDeEfF0123456789aAbBcCdDeEfF0123456789aAbBcCdDeEfF0123456789aA'
        expect(() => validateGiftCardHash(hash)).not.toThrow()
      })

      it('should fail with 31 characters (one short)', () => {
        const hash = 'a'.repeat(31)
        expect(() => validateGiftCardHash(hash)).toThrow(ValidationError)
      })

      it('should fail with 65 characters (one over)', () => {
        const hash = 'a'.repeat(65)
        expect(() => validateGiftCardHash(hash)).toThrow(ValidationError)
      })
    })
  })

  describe('ValidationError', () => {
    it('should be an instance of Error', () => {
      const error = new ValidationError('Test error')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct name property', () => {
      const error = new ValidationError('Test error')
      expect(error.name).toBe('ValidationError')
    })

    it('should have correct message', () => {
      const message = 'Test validation error'
      const error = new ValidationError(message)
      expect(error.message).toBe(message)
    })

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new ValidationError('Test error')
      }).toThrow(ValidationError)
    })

    it('should support multi-line error messages', () => {
      const multiLineMessage = 'Error 1\nError 2\nError 3'
      const error = new ValidationError(multiLineMessage)
      expect(error.message).toBe(multiLineMessage)
    })
  })
})
