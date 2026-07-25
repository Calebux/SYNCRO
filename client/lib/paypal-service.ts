/**
 * PayPal Payment Service
 * Implements PayPal Orders API v2 for payment processing
 * 
 * Features:
 * - OAuth 2.0 authentication with token caching
 * - Automatic retry logic for transient failures
 * - Comprehensive error handling with specific error codes
 * - Order creation, capture, and refund support
 * 
 * @see https://developer.paypal.com/docs/api/orders/v2/
 */

export interface PayPalConfig {
    clientId: string
    clientSecret: string
    mode: 'sandbox' | 'live'
    maxRetries?: number
    retryDelay?: number
}

export interface PayPalError {
    name: string
    message: string
    debug_id?: string
    details?: Array<{
        issue: string
        description: string
    }>
}

export interface PayPalOrderResponse {
    id: string
    status: string
    links: Array<{
        href: string
        rel: string
        method: string
    }>
}

export interface PayPalCaptureResponse {
    id: string
    status: string
    purchase_units: Array<{
        payments: {
            captures: Array<{
                id: string
                status: string
                amount: {
                    currency_code: string
                    value: string
                }
                status_details?: {
                    reason?: string
                }
            }>
        }
    }>
}

export class PayPalService {
    private clientId: string
    private clientSecret: string
    private baseUrl: string
    private accessToken: string | null = null
    private tokenExpiry: number = 0
    private maxRetries: number
    private retryDelay: number

    constructor(config: PayPalConfig) {
        this.clientId = config.clientId
        this.clientSecret = config.clientSecret
        this.baseUrl = config.mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com'
        this.maxRetries = config.maxRetries || 3
        this.retryDelay = config.retryDelay || 1000
    }

    /**
     * Retry logic for transient failures
     */
    private async retryWithBackoff<T>(
        operation: () => Promise<T>,
        operationName: string,
        retries = this.maxRetries
    ): Promise<T> {
        try {
            return await operation()
        } catch (error: any) {
            // Don't retry on client errors (4xx) except 408, 429
            if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
                if (error.statusCode !== 408 && error.statusCode !== 429) {
                    throw error
                }
            }

            if (retries <= 0) {
                console.error(`[PayPalService] ${operationName} failed after all retries`)
                throw error
            }

            const delay = this.retryDelay * (this.maxRetries - retries + 1)
            console.warn(
                `[PayPalService] ${operationName} failed, retrying in ${delay}ms... (${retries} retries left)`
            )

            await new Promise(resolve => setTimeout(resolve, delay))
            return this.retryWithBackoff(operation, operationName, retries - 1)
        }
    }

    /**
     * Parse PayPal error response
     */
    private parsePayPalError(error: any): string {
        if (error.details && Array.isArray(error.details)) {
            const issues = error.details.map((d: any) => d.description || d.issue).join('; ')
            return `${error.message || 'PayPal error'}: ${issues}`
        }
        return error.message || 'Unknown PayPal error'
    }

    /**
     * Get OAuth access token for PayPal API
     */
    private async getAccessToken(): Promise<string> {
        // Return cached token if still valid
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken
        }

        return this.retryWithBackoff(async () => {
            const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

            const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'grant_type=client_credentials',
            })

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: response.statusText }))
                const err: any = new Error(`PayPal auth failed: ${this.parsePayPalError(error)}`)
                err.statusCode = response.status
                throw err
            }

            const data = await response.json()
            this.accessToken = data.access_token
            // Set expiry to 5 minutes before actual expiry for safety
            this.tokenExpiry = Date.now() + ((data.expires_in - 300) * 1000)

            return this.accessToken
        }, 'getAccessToken')
    }

    /**
     * Create a PayPal order
     */
    async createOrder(
        amount: number,
        currency: string = 'USD',
        metadata: {
            userId: string
            planName: string
            returnUrl: string
            cancelUrl: string
        }
    ): Promise<PayPalOrderResponse> {
        return this.retryWithBackoff(async () => {
            const accessToken = await this.getAccessToken()

            const orderData = {
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        amount: {
                            currency_code: currency.toUpperCase(),
                            value: amount.toFixed(2),
                        },
                        description: `${metadata.planName} subscription`,
                        custom_id: metadata.userId,
                    },
                ],
                application_context: {
                    return_url: metadata.returnUrl,
                    cancel_url: metadata.cancelUrl,
                    brand_name: 'SYNCRO',
                    user_action: 'PAY_NOW',
                },
            }

            const response = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation',
                },
                body: JSON.stringify(orderData),
            })

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[PayPalService] Order creation failed:', error)
                const err: any = new Error(`PayPal order creation failed: ${this.parsePayPalError(error)}`)
                err.statusCode = response.status
                throw err
            }

            const order = await response.json()
            console.log('[PayPalService] Order created successfully:', order.id)

            return order
        }, 'createOrder')
    }

    /**
     * Capture payment for an approved order
     */
    async captureOrder(orderId: string): Promise<PayPalCaptureResponse> {
        return this.retryWithBackoff(async () => {
            const accessToken = await this.getAccessToken()

            const response = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation',
                },
            })

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[PayPalService] Capture failed:', error)
                const err: any = new Error(`PayPal capture failed: ${this.parsePayPalError(error)}`)
                err.statusCode = response.status
                throw err
            }

            const capture = await response.json()
            console.log('[PayPalService] Payment captured successfully:', capture.id)

            return capture
        }, 'captureOrder')
    }

    /**
     * Get order details
     */
    async getOrder(orderId: string): Promise<PayPalOrderResponse> {
        return this.retryWithBackoff(async () => {
            const accessToken = await this.getAccessToken()

            const response = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            })

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: response.statusText }))
                const err: any = new Error(`Failed to get order: ${this.parsePayPalError(error)}`)
                err.statusCode = response.status
                throw err
            }

            return await response.json()
        }, 'getOrder')
    }

    /**
     * Refund a captured payment
     */
    async refundCapture(captureId: string, amount?: number, currency?: string): Promise<any> {
        return this.retryWithBackoff(async () => {
            const accessToken = await this.getAccessToken()

            const refundData: any = {}
            if (amount && currency) {
                refundData.amount = {
                    currency_code: currency.toUpperCase(),
                    value: amount.toFixed(2),
                }
            }

            const response = await fetch(
                `${this.baseUrl}/v2/payments/captures/${captureId}/refund`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation',
                    },
                    body: JSON.stringify(refundData),
                }
            )

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[PayPalService] Refund failed:', error)
                const err: any = new Error(`PayPal refund failed: ${this.parsePayPalError(error)}`)
                err.statusCode = response.status
                throw err
            }

            const refund = await response.json()
            console.log('[PayPalService] Refund processed successfully:', refund.id)

            return refund
        }, 'refundCapture')
    }
}

/**
 * Get PayPal service instance
 */
export function getPayPalService(): PayPalService | null {
    const clientId = process.env.PAYPAL_CLIENT_ID
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET
    const mode = (process.env.PAYPAL_MODE || 'sandbox') as 'sandbox' | 'live'

    if (!clientId || !clientSecret) {
        console.warn('[PayPalService] PayPal credentials not configured')
        return null
    }

    return new PayPalService({
        clientId,
        clientSecret,
        mode,
    })
}
