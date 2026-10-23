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

export interface PayPalRefundResponse {
    id: string
    status: string
    amount?: {
        currency_code: string
        value: string
    }
}

export interface PayPalRefundRequest {
    amount?: {
        currency_code: string
        value: string
    }
}

/** Error with an HTTP status code attached for retry decisions. */
class PayPalHttpError extends Error {
    statusCode: number

    constructor(message: string, statusCode: number) {
        super(message)
        this.name = 'PayPalHttpError'
        this.statusCode = statusCode
    }
}

function getErrorStatusCode(error: unknown): number | undefined {
    if (error instanceof PayPalHttpError) return error.statusCode
    if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof (error as { statusCode: unknown }).statusCode === 'number'
    ) {
        return (error as { statusCode: number }).statusCode
    }
    return undefined
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
        } catch (error: unknown) {
            // Don't retry on client errors (4xx) except 408, 429
            const statusCode = getErrorStatusCode(error)
            if (statusCode && statusCode >= 400 && statusCode < 500) {
                if (statusCode !== 408 && statusCode !== 429) {
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
    private parsePayPalError(error: unknown): string {
        if (
            typeof error === 'object' &&
            error !== null &&
            'details' in error &&
            Array.isArray((error as PayPalError).details)
        ) {
            const paypalError = error as PayPalError
            const issues = paypalError.details!
                .map((d) => d.description || d.issue)
                .join('; ')
            return `${paypalError.message || 'PayPal error'}: ${issues}`
        }
        if (error instanceof Error) return error.message
        if (
            typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            typeof (error as { message: unknown }).message === 'string'
        ) {
            return (error as { message: string }).message
        }
        return 'Unknown PayPal error'
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
                throw new PayPalHttpError(
                    `PayPal auth failed: ${this.parsePayPalError(error)}`,
                    response.status
                )
            }

            const data = await response.json() as { access_token: string; expires_in: number }
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
                throw new PayPalHttpError(
                    `PayPal order creation failed: ${this.parsePayPalError(error)}`,
                    response.status
                )
            }

            const order = await response.json() as PayPalOrderResponse
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
                throw new PayPalHttpError(
                    `PayPal capture failed: ${this.parsePayPalError(error)}`,
                    response.status
                )
            }

            const capture = await response.json() as PayPalCaptureResponse
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
                throw new PayPalHttpError(
                    `Failed to get order: ${this.parsePayPalError(error)}`,
                    response.status
                )
            }

            return await response.json() as PayPalOrderResponse
        }, 'getOrder')
    }

    /**
     * Refund a captured payment
     */
    async refundCapture(captureId: string, amount?: number, currency?: string): Promise<PayPalRefundResponse> {
        return this.retryWithBackoff(async () => {
            const accessToken = await this.getAccessToken()

            const refundData: PayPalRefundRequest = {}
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
                throw new PayPalHttpError(
                    `PayPal refund failed: ${this.parsePayPalError(error)}`,
                    response.status
                )
            }

            const refund = await response.json() as PayPalRefundResponse
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
