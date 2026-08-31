import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { userPreferenceService } from '../services/user-preference-service';
import { delayedNotificationService } from '../services/delayed-notification-service';
import { 
  fullUserPreferencesUpdateSchema, 
  quietHoursUpdateSchemaWithValidation 
} from '../schemas/user-preferences';
import logger from '../config/logger';

const router = Router();

/**
 * GET /api/user-preferences
 * Get current user preferences
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const preferences = await userPreferenceService.getPreferences(req.user!.id);
    res.json({ success: true, data: preferences });
  } catch (error) {
    logger.error('Error fetching user preferences:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch user preferences' 
    });
  }
});

/**
 * PATCH /api/user-preferences
 * Update user preferences (including quiet hours)
 */
router.patch('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validatedData = validateRequest(fullUserPreferencesUpdateSchema, req.body);
    
    const updatedPreferences = await userPreferenceService.updatePreferences(
      req.user!.id,
      validatedData
    );

    res.json({ 
      success: true, 
      data: updatedPreferences,
      message: 'User preferences updated successfully'
    });
  } catch (error) {
    logger.error('Error updating user preferences:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update user preferences' 
    });
  }
});

/**
 * PATCH /api/user-preferences/quiet-hours
 * Update only quiet hours settings
 */
router.patch('/quiet-hours', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validatedData = validateRequest(quietHoursUpdateSchemaWithValidation, req.body);
    
    const updatedPreferences = await userPreferenceService.updatePreferences(
      req.user!.id,
      validatedData
    );

    res.json({ 
      success: true, 
      data: {
        quiet_hours_enabled: updatedPreferences.quiet_hours_enabled,
        quiet_hours_start: updatedPreferences.quiet_hours_start,
        quiet_hours_end: updatedPreferences.quiet_hours_end,
        quiet_hours_timezone: updatedPreferences.quiet_hours_timezone,
        critical_alerts_only: updatedPreferences.critical_alerts_only,
      },
      message: 'Quiet hours settings updated successfully'
    });
  } catch (error) {
    logger.error('Error updating quiet hours settings:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update quiet hours settings' 
    });
  }
});

/**
 * GET /api/user-preferences/delayed-notifications
 * Get user's delayed notifications (for debugging/admin purposes)
 */
router.get('/delayed-notifications', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as 'pending' | 'sent' | 'cancelled' | undefined;
    
    const delayedNotifications = await delayedNotificationService.getUserDelayedNotifications(
      req.user!.id,
      status
    );

    res.json({ 
      success: true, 
      data: delayedNotifications,
      count: delayedNotifications.length
    });
  } catch (error) {
    logger.error('Error fetching delayed notifications:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch delayed notifications' 
    });
  }
});

/**
 * POST /api/user-preferences/test-quiet-hours
 * Test quiet hours configuration (for debugging)
 */
router.post('/test-quiet-hours', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { testTime } = req.body;
    const testDate = testTime ? new Date(testTime) : new Date();
    
    const preferences = await userPreferenceService.getPreferences(req.user!.id);
    
    // Import the service here to avoid circular dependencies
    const { quietHoursService } = await import('../services/quiet-hours-service');
    
    const isQuietHours = quietHoursService.isInQuietHours(preferences, testDate);
    const isAppropriateTime = quietHoursService.isAppropriateTimeForDelayedNotifications(preferences, testDate);
    const quietHoursEnd = isQuietHours ? quietHoursService.getQuietHoursEndTime(preferences, testDate) : null;

    res.json({
      success: true,
      data: {
        testTime: testDate.toISOString(),
        userTimezone: preferences.quiet_hours_timezone,
        quietHoursEnabled: preferences.quiet_hours_enabled,
        quietHoursStart: preferences.quiet_hours_start,
        quietHoursEnd: preferences.quiet_hours_end,
        isCurrentlyQuietHours: isQuietHours,
        isAppropriateTimeForDelayed: isAppropriateTime,
        quietHoursEndTime: quietHoursEnd?.toISOString() || null,
        criticalAlertsOnly: preferences.critical_alerts_only,
      }
    });
  } catch (error) {
    logger.error('Error testing quiet hours:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to test quiet hours configuration' 
    });
  }
});

export default router;