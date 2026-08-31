import { Router, Response, Request } from 'express';
import { merchantService } from '../services/merchant-service';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { adminAuth } from '../middleware/admin';
import { createMerchantSchema, updateMerchantSchema, merchantQuerySchema } from '../schemas/merchant';
import { validateRequest } from '../utils/validation';
import { PaginationError } from '../utils/pagination';
import { z } from 'zod';

type MerchantQuery = z.infer<typeof merchantQuerySchema>;

const router: Router = Router();

/**
 * GET /api/merchants
 * List merchants with optional filtering
 */
router.get(
  '/',
  validate(merchantQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    try {
      const { limit, offset, category } = req.query as MerchantQuery;

      const result = await merchantService.listMerchants({
        category,
        limit,
        offset,
      });

      res.json({
        success: true,
        data: result.merchants,
        pagination: { total: result.total, limit, offset },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'PaginationError') {
        res.status(400).json({
          success: false,
          error: error.message,
          code: (error as { code?: string }).code,
        });
        return;
      }
      logger.error('List merchants error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list merchants',
      });
    }
  },
);

/**
 * GET /api/merchants/:id
 * Get a merchant by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const merchant = await merchantService.getMerchant(req.params.id as string);
    res.json({ success: true, data: merchant });
  } catch (error) {
    logger.error('Get merchant error:', error);
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get merchant',
    });
  }
});

/**
 * POST /api/merchants
 * Create a merchant (admin only)
 */
router.post(
  '/',
  adminAuth,
  validate(createMerchantSchema),
  async (req: Request, res: Response) => {
    try {
      const merchant = await merchantService.createMerchant(req.body);
      res.status(201).json({ success: true, data: merchant });
    } catch (error) {
      logger.error('Create merchant error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create merchant',
      });
    }
  },
);

/**
 * PATCH /api/merchants/:id
 * Update a merchant (admin only)
 */
router.patch(
  '/:id',
  adminAuth,
  validate(updateMerchantSchema),
  async (req: Request, res: Response) => {
    try {
      const merchant = await merchantService.updateMerchant(req.params.id as string, req.body);
      res.json({ success: true, data: merchant });
    } catch (error) {
      logger.error('Update merchant error:', error);
      const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update merchant',
      });
    }
  },
);

/**
 * DELETE /api/merchants/:id
 * Delete a merchant (admin only)
 */
router.delete('/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    await merchantService.deleteMerchant(req.params.id as string);
    res.json({ success: true, message: 'Merchant deleted' });
  } catch (error) {
    logger.error('Delete merchant error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete merchant',
    });
  }
});

export default router;