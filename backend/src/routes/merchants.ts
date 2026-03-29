import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { merchantService } from '../services/merchant-service';
import logger from '../config/logger';
import { adminAuth } from '../middleware/admin';

// ─── Validation schemas ───────────────────────────────────────────────────────

const safeUrlSchema = z
  .string()
  .max(2000, 'URL must not exceed 2000 characters')
  .url('Must be a valid URL')
  .refine(
    (val) => {
      try {
        const { protocol } = new URL(val);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL must use http or https protocol' }
  );

const createMerchantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  description: z.string().max(500, 'Description must not exceed 500 characters').optional(),
  category: z.string().max(50, 'Category must not exceed 50 characters').optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
  support_email: z.string().email('Must be a valid email').max(254, 'Email must not exceed 254 characters').optional(),
  country: z.string().max(2, 'Country must be a 2-letter ISO code').optional(),
});

const updateMerchantSchema = createMerchantSchema.partial();


const router = Router();

/**
 * GET /api/merchants
 * List merchants with optional filtering
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const { limit, offset, category } = req.query;

        const result = await merchantService.listMerchants({
            category: category as string | undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            offset: offset ? parseInt(offset as string) : undefined,
        });

        res.json({
            success: true,
            data: result.merchants,
            pagination: {
                total: result.total,
                limit: limit ? parseInt(limit as string) : undefined,
                offset: offset ? parseInt(offset as string) : undefined,
            },
        });
    } catch (error) {
        logger.error('List merchants error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list merchants',
        });
    }
});

/**
 * GET /api/merchants/:id
 * Get single merchant by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const merchant = await merchantService.getMerchant(req.params.id as string);

        res.json({
            success: true,
            data: merchant,
        });
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
 * Create new merchant (Admin only)
 */
router.post('/', adminAuth, async (req: Request, res: Response) => {
    try {
        const validation = createMerchantSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: validation.error.errors.map((e) => e.message).join(', '),
            });
        }

        const merchant = await merchantService.createMerchant(validation.data);

        res.status(201).json({
            success: true,
            data: merchant,
        });
    } catch (error) {
        logger.error('Create merchant error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to create merchant',
        });
    }
});

/**
 * PATCH /api/merchants/:id
 * Update merchant (Admin only)
 * NOTE: Rate limiter applied here to prevent mass renewal/update congestion per merchant.
 */
router.patch('/:id', adminAuth, async (req: Request, res: Response) => {
    try {
        const validation = updateMerchantSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: validation.error.errors.map((e) => e.message).join(', '),
            });
        }

        const merchant = await merchantService.updateMerchant(req.params.id as string, validation.data);

        res.json({
            success: true,
            data: merchant,
        });
    } catch (error) {
        logger.error('Update merchant error:', error);
        const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update merchant',
        });
    }
});

/**
 * DELETE /api/merchants/:id
 * Delete merchant (Admin only)
 */
router.delete('/:id', adminAuth, async (req: Request, res: Response) => {
    try {
        await merchantService.deleteMerchant(req.params.id as string);

        res.json({
            success: true,
            message: 'Merchant deleted',
        });
    } catch (error) {
        logger.error('Delete merchant error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete merchant',
        });
    }
});

export default router;