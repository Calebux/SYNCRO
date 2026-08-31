/**
 * PayPal Webhook Handler
 * Handles PayPal webhook events for payment status updates
 * 
 * Supported events:
 * - PAYMENT.CAPTURE.COMPLETED
 * - PAYMENT.CAPTURE.DENIED
 * - PAYMENT.CAPTURE.REFUNDED
 * - CHECKOUT.ORDER.APPROVED
 * - CHECKOUT.ORDER.COMPLETED
 * 
 * @see https://developer.paypal.com/api/rest/webhooks/
 */

import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import crypto from "crypto"

interface PayPalWebhookEvent {
    id: string
    event_type: string
    resource_type: string
    summary: string
    resource: {
        id: string
        status: string
        amount?: {
            currency_code: string
            value: string
        }
        custom_id?: string
    }
    create_time: string
}

/**
 * Verify PayPal webhook signature
 * @see https://developer.paypal.com/api/rest/webhooks/rest/#verify-webhook-signature
 */
async function verifyWebhookSignature(
    request: NextRequest,
    body: string
): Promise<boolean> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID
    
    if (!webhookId) {
        logger.warn('[PayPal Webhook] PAYPAL_WEBHOOK_ID not configured, skipping signature verification')
        return true // Allow in development
    }

    const transmissionId = request.headers.get('paypal-transmission-id')
    const transmissionTime = request.headers.get('paypal-transmission-time')
    const certUrl = request.headers.get('paypal-cert-url')
    const authAlgo = request.headers.get('paypal-auth-algo')
    const transmissionSig = request.headers.get('paypal-transmission-sig')

    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
        logger.error('[PayPal Webhook] Missing required headers')
        return false
    }

    try {
        // Verify signature using PayPal API
        const paypalMode = process.env.PAYPAL_MODE || 'sandbox'
        const baseUrl = paypalMode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com'

        // Get access token
        const clientId = process.env.PAYPAL_CLIENT_ID
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

        const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        })

        if (!tokenResponse.ok) {
            logger.error('[PayPal Webhook] Failed to get access token')
            return false
        }

        const { access_token } = await tokenResponse.json()

        // Verify webhook signature
        const verifyResponse = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                transmission_id: transmissionId,
                transmission_time: transmissionTime,
                cert_url: certUrl,
                auth_algo: authAlgo,
                transmission_sig: transmissionSig,
                webhook_id: webhookId,
                webhook_event: JSON.parse(body),
            }),
        })

        if (!verifyResponse.ok) {
            logger.error('[PayPal Webhook] Signature verification failed')
            return false
        }

        const verifyData = await verifyResponse.json()
        return verifyData.verification_status === 'SUCCESS'
    } catch (error) {
        logger.error('[PayPal Webhook] Error verifying signature', { err: error })
        return false
    }
}

/**
 * Handle PayPal webhook events
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.text()
        const event: PayPalWebhookEvent = JSON.parse(body)

        logger.info('[PayPal Webhook] Received event', { eventType: event.event_type, eventId: event.id })

        // Verify webhook signature
        const isValid = await verifyWebhookSignature(request, body)
        if (!isValid) {
            logger.error('[PayPal Webhook] Invalid signature')
            return NextResponse.json(
                { error: 'Invalid signature' },
                { status: 401 }
            )
        }

        // Check idempotency and store event BEFORE processing
        // This ensures we never process the same event twice even under concurrent delivery
        const supabase = await createClient()

        // Check if event already exists
        const { data: existingRecord, error: checkError } = await supabase
            .from('webhook_events')
            .select('id, processed_at')
            .eq('provider', 'paypal')
            .eq('event_id', event.id)
            .maybeSingle()

        if (checkError && checkError.code !== 'PGRST116') {
            logger.error('[PayPal Webhook] Failed to check idempotency', {
                eventId: event.id,
                error: checkError.message,
            })
            return NextResponse.json(
                { error: 'Idempotency check failed' },
                { status: 500 }
            )
        }

        if (existingRecord) {
            logger.info('[PayPal Webhook] Duplicate event detected', {
                eventId: event.id,
                processedAt: existingRecord.processed_at,
            })
            return NextResponse.json({ received: true, duplicate: true })
        }

        // Store webhook event BEFORE processing to prevent concurrent duplicate processing
        const { error: insertError, data: newRecord } = await supabase
            .from('webhook_events')
            .insert({
                provider: 'paypal',
                event_id: event.id,
                event_type: event.event_type,
                event_data: event,
                processed: false,
                created_at: new Date().toISOString(),
            })
            .select('id')
            .single()

        if (insertError) {
            // Check if it's a unique constraint violation (concurrent delivery)
            if (insertError.code === '23505') {
                logger.info('[PayPal Webhook] Concurrent delivery detected', {
                    eventId: event.id,
                })
                return NextResponse.json({ received: true, duplicate: true })
            }
            logger.error('[PayPal Webhook] Failed to store webhook event', {
                eventId: event.id,
                error: insertError.message,
            })
            return NextResponse.json(
                { error: 'Failed to store webhook' },
                { status: 500 }
            )
        }

        // Process event based on type
        switch (event.event_type) {
            case 'PAYMENT.CAPTURE.COMPLETED':
                await handleCaptureCompleted(event)
                break

            case 'PAYMENT.CAPTURE.DENIED':
                await handleCaptureDenied(event)
                break

            case 'PAYMENT.CAPTURE.REFUNDED':
                await handleCaptureRefunded(event)
                break

            case 'CHECKOUT.ORDER.APPROVED':
                await handleOrderApproved(event)
                break

            case 'CHECKOUT.ORDER.COMPLETED':
                await handleOrderCompleted(event)
                break

            default:
                logger.info('[PayPal Webhook] Unhandled event type', { eventType: event.event_type })
        }

        // Mark event as processed
        await supabase
            .from('webhook_events')
            .update({ processed: true, processed_at: new Date().toISOString() })
            // Keep the state transition in the same provider/event namespace as
            // the idempotency check. This prevents an identical event ID from a
            // different provider ever being updated by this handler.
            .eq('provider', 'paypal')
            .eq('event_id', event.id)

        return NextResponse.json({ received: true })
    } catch (error) {
        logger.error('[PayPal Webhook] Error processing webhook', { err: error })
        return NextResponse.json(
            { error: 'Webhook processing failed' },
            { status: 500 }
        )
    }
}

/**
 * Handle PAYMENT.CAPTURE.COMPLETED event
 */
async function handleCaptureCompleted(event: PayPalWebhookEvent) {
    const captureId = event.resource.id
    const supabase = await createClient()

    logger.info('[PayPal Webhook] Processing capture completed', { captureId })

    // Update payment status in database
    const { error } = await supabase
        .from('payments')
        .update({
            status: 'succeeded',
            updated_at: new Date().toISOString(),
        })
        .eq('transaction_id', captureId)

    if (error) {
        logger.error('[PayPal Webhook] Failed to update payment', { err: error, captureId })
        throw error
    }

    logger.info('[PayPal Webhook] Payment updated successfully', { captureId })
}

/**
 * Handle PAYMENT.CAPTURE.DENIED event
 */
async function handleCaptureDenied(event: PayPalWebhookEvent) {
    const captureId = event.resource.id
    const supabase = await createClient()

    logger.info('[PayPal Webhook] Processing capture denied', { captureId })

    const { error } = await supabase
        .from('payments')
        .update({
            status: 'failed',
            updated_at: new Date().toISOString(),
        })
        .eq('transaction_id', captureId)

    if (error) {
        logger.error('[PayPal Webhook] Failed to update payment', { err: error, captureId })
        throw error
    }
}

/**
 * Handle PAYMENT.CAPTURE.REFUNDED event
 */
async function handleCaptureRefunded(event: PayPalWebhookEvent) {
    const captureId = event.resource.id
    const supabase = await createClient()

    logger.info('[PayPal Webhook] Processing capture refunded', { captureId })

    const { error } = await supabase
        .from('payments')
        .update({
            status: 'refunded',
            updated_at: new Date().toISOString(),
        })
        .eq('transaction_id', captureId)

    if (error) {
        logger.error('[PayPal Webhook] Failed to update payment', { err: error, captureId })
        throw error
    }
}

/**
 * Handle CHECKOUT.ORDER.APPROVED event
 */
async function handleOrderApproved(event: PayPalWebhookEvent) {
    const orderId = event.resource.id
    logger.info('[PayPal Webhook] Order approved', { orderId })
    
    // Order is approved but not yet captured
    // The capture will happen when the user returns to the app
}

/**
 * Handle CHECKOUT.ORDER.COMPLETED event
 */
async function handleOrderCompleted(event: PayPalWebhookEvent) {
    const orderId = event.resource.id
    logger.info('[PayPal Webhook] Order completed', { orderId })
    
    // Order is completed, payment should already be captured
}
