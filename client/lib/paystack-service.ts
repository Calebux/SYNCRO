/**
 * Paystack Payment Service — client side
 *
 * This service calls the Express backend's Paystack routes.
 * The PAYSTACK_SECRET_KEY never leaves the backend — this file
 * only holds the base URL and makes authenticated fetch calls
 * through the backend proxy.
 *
 * Mirrors the PayPal service pattern for consistency.
 */

import { getApiConfig } from './api/env'

export interface PaystackInitResponse {
  authorization_url: string
  access_code: string
  reference: string
}

export interface PaystackVerifyResponse {
  status: string // 'success' | 'failed' | 'abandoned'
  reference: string
  amount: number // kobo
  currency: string
  paid_at: string
  customer: { email: string }
}

export class PaystackService {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /**
   * Initialize a transaction via the backend.
   * Returns a Paystack-hosted checkout URL to redirect the user to.
   * Amount must be in kobo (100 kobo = ₦1).
   */
  async initializeTransaction(params: {
    email: string
    amountKobo: number
    reference: string
    metadata?: Record<string, unknown>
  }): Promise<PaystackInitResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/payments/paystack/initialize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }
    )

    if (!res.ok) {
      const err = await res.json()
      throw new Error(
        `Paystack initialization failed: ${err.error || 'Unknown error'}`
      )
    }

    const data = await res.json()
    return data.data as PaystackInitResponse
  }

  /**
   * Verify a completed transaction via the backend.
   */
  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/payments/paystack/verify/${encodeURIComponent(reference)}`
    )

    if (!res.ok) {
      const err = await res.json()
      throw new Error(
        `Paystack verification failed: ${err.error || 'Unknown error'}`
      )
    }

    const data = await res.json()
    return data.data as PaystackVerifyResponse
  }
}

/**
 * Get a Paystack service instance.
 * Returns null if PAYSTACK_SECRET_KEY is not set — callers must handle this.
 */
export function getPaystackService(): PaystackService | null {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.warn('[PaystackService] PAYSTACK_SECRET_KEY not configured')
    return null
  }

  const { baseUrl } = getApiConfig()
  return new PaystackService(baseUrl)
}