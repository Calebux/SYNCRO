import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { reminderSettingsService } from '../services/reminder-settings-service';
import logger from '../config/logger';
import { z } from 'zod';

const reminderSettingsUpdateSchema = z.object({
  reminder_days_before: z.array(z.number().int().min(1).max(365)).optional(),
});

const router = Router();

/**
 * GET /api/reminder-settings
 * Get current reminder settings
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await reminderSettingsService.getSettings(req.user!.id);
    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error('Error fetching reminder settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reminder settings'
    });
  }
});

/**
 * PATCH /api/reminder-settings
 * Update reminder settings
 */
router.patch('/', validate(reminderSettingsUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validatedData = req.body;

    const updatedSettings = await reminderSettingsService.updateSettings(
      req.user!.id,
      validatedData
    );

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Reminder settings updated successfully'
    });
  } catch (error) {
    logger.error('Error updating reminder settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update reminder settings'
    });
  }
});

export default router;