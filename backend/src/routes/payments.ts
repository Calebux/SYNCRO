import { Router, Request, Response } from 'express'
import {
  initializeFunding,
  verifyTransaction,
  listBanks,
} from '../services/paystack'

const router = Router()

/**
 * POST /api/payments/paystack/initialize
 *
 * Initialize a Paystack wallet-funding transaction.
 * Returns an authorization_url to redirect the user to.
 *
 * Body: { email, amountKobo, reference, metadata? }
 */
router.post(
  '/paystack/initialize',
  async (req: Request, res: Response) => {
    try {
      const { email, amountKobo, reference, callbackUrl, metadata } = req.body

      if (!email || !amountKobo || !reference) {
        return res.status(400).json({
          error: 'email, amountKobo, and reference are required',
        })
      }

      const result = await initializeFunding({
        email,
        amountKobo: Number(amountKobo),
        reference,
        callbackUrl,
        metadata,
      })

      return res.status(200).json({ success: true, data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return res.status(500).json({ error: message })
    }
  }
)

/**
 * GET /api/payments/paystack/verify/:reference
 *
 * Verify a completed Paystack transaction by reference.
 * Called after the user returns from the Paystack-hosted checkout page.
 */
router.get(
  '/paystack/verify/:reference',
  async (req: Request, res: Response) => {
    try {
      const result = await verifyTransaction(req.params.reference)
      return res.status(200).json({ success: true, data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return res.status(500).json({ error: message })
    }
  }
)

/**
 * GET /api/payments/paystack/banks
 *
 * List supported Nigerian banks.
 * Used by the sub-account setup UI.
 */
router.get('/paystack/banks', async (_req: Request, res: Response) => {
  try {
    const banks = await listBanks()
    return res.status(200).json({ success: true, data: banks })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
})

export default router