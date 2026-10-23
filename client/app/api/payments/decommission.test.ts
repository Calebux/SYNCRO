import { describe, expect, it } from 'vitest'
import { POST as paymentPost } from './route'
import { POST as capturePost } from './paypal/capture/route'
import { POST as refundPost } from './refund/route'
import { POST as stripeWebhookPost } from '../webhooks/stripe/route'
import { POST as paypalWebhookPost } from '../webhooks/paypal/route'

describe('retired payment integrations', () => {
    it('rejects every processor endpoint without reading credentials', async () => {
        for (const handler of [
            paymentPost,
            capturePost,
            refundPost,
            stripeWebhookPost,
            paypalWebhookPost,
        ]) {
            expect((await handler()).status).toBe(410)
        }
    })
})
