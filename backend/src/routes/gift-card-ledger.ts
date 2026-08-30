import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth';
import { giftCardLedgerService } from '../services/gift-card-ledger-service';
import { giftCardLedgerVerifier } from '../services/gift-card-ledger-verifier';
import { validate } from '../middleware/validate';
import { BadRequestError } from '../errors';
import { parseDbError } from '../utils/db-constraint-errors';
import { validateLimit } from '../utils/pagination';

const router = Router();

const topUpSchema = z.object({
  amount: z.number().positive(),
  description: z.string().max(255).optional(),
});

const deductSchema = z.object({
  subscriptionId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().max(255).optional(),
});

const reverseSchema = z.object({
  originalTransactionId: z.string().uuid(),
  description: z.string().max(255).optional(),
});

/** GET /api/gift-card-ledger/balance */
// VALIDATION_BYPASS: No request body or params needed
router.get('/balance', async (req: AuthenticatedRequest, res: Response) => {
  const balance = await giftCardLedgerService.getBalance(req.user!.id);
  res.json({ success: true, balance, formatted: `$${balance.toFixed(2)} remaining` });
});

/** GET /api/gift-card-ledger/history */
// VALIDATION_BYPASS: Simple integer parsing
router.get('/history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = validateLimit(req.query.limit, 100, 50);
    const history = await giftCardLedgerService.getHistory(req.user!.id, limit);
    res.json({ success: true, data: history });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'PaginationError') {
      throw new BadRequestError(error.message);
    }
    throw error;
  }
});

/** POST /api/gift-card-ledger/top-up */
router.post('/top-up', validate(topUpSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, description } = req.body;
    const entry = await giftCardLedgerService.topUp(req.user!.id, amount, description);
    res.status(201).json({ success: true, data: entry });
  } catch (err: unknown) {
    const appError = parseDbError(err);
    if (appError) {
      return res.status(appError.status).json({ success: false, error: appError.message, field: appError.field });
    }
    throw err;
  }
});

/** POST /api/gift-card-ledger/deduct */
router.post('/deduct', validate(deductSchema), async (req: AuthenticatedRequest, res: Response) => {
  const { subscriptionId, amount, description } = req.body;
  try {
    const entry = await giftCardLedgerService.deduct(req.user!.id, subscriptionId, amount, description);
    res.status(201).json({ success: true, data: entry });
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.startsWith('Insufficient balance')) {
      throw new BadRequestError(err.message);
    }
    const appError = parseDbError(err);
    if (appError) {
      return res.status(appError.status).json({ success: false, error: appError.message, field: appError.field });
    }
    throw err;
  }
});

/** POST /api/gift-card-ledger/reverse */
router.post('/reverse', validate(reverseSchema), async (req: AuthenticatedRequest, res: Response) => {
  const { originalTransactionId, description } = req.body;
  try {
    const entry = await giftCardLedgerService.reverseTransaction(
      req.user!.id,
      originalTransactionId,
      description
    );
    res.status(201).json({ success: true, data: entry });
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('not found')) {
      throw new BadRequestError(err.message);
    }
    const appError = parseDbError(err);
    if (appError) {
      return res.status(appError.status).json({ success: false, error: appError.message, field: appError.field });
    }
    throw err;
  }
});

/** POST /api/gift-card-ledger/verify */
// VALIDATION_BYPASS: Triggers admin/periodic verification run
router.post('/verify', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = await giftCardLedgerVerifier.verifyLedger();
    res.json({ success: summary.success, summary });
  } catch (err: unknown) {
    logger.error('Verification endpoint error:', err);
    res.status(500).json({ success: false, error: 'Verification job failed' });
  }
});

export default router;
