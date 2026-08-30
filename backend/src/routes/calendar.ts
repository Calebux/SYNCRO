import { Router, Response, Request } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { calendarService, verifyCalendarToken } from '../services/calendar-service';
import logger from '../config/logger';
import { env } from '../config/env';
import { z } from 'zod';

const router: Router = Router();

const calendarPreferencesSchema = z.object({
  calendar_sync_enabled: z.boolean().optional(),
  calendar_export_reminders: z.boolean().optional(),
});

function getFeedBaseUrl(req: Request): string {
  const configured = env.CALENDAR_FEED_BASE_URL || env.FRONTEND_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  const host = req.get('host');
  const protocol = req.protocol;
  return `${protocol}://${host}`;
}

/**
 * GET /api/calendar/feed/:userId/:token.ics
 * Public endpoint for iCal feed (authenticated via token)
 */
// VALIDATION_BYPASS: Token manually verified
router.get('/feed/:userId/:token.ics', async (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

    if (!verifyCalendarToken(userId, token)) {
      return res.status(403).send('Invalid calendar token');
    }

    const feed = await calendarService.generateFeed(userId);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="subscriptions.ics"');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(feed);
  } catch (error) {
    if (error instanceof Error && error.message === 'Calendar sync is disabled for this user') {
      return res.status(403).send('Calendar sync is disabled');
    }
    logger.error('Calendar feed error:', error);
    res.status(500).send('Internal server error');
  }
});

/**
 * GET /api/calendar/token
 * Get current user's calendar token (requires standard auth)
 */
router.get('/token', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tokenResponse = await calendarService.getToken(req.user!.id, getFeedBaseUrl(req));
    res.json({
      success: true,
      token: tokenResponse.token,
      userId: tokenResponse.userId,
      feedUrl: tokenResponse.feedUrl,
    });
  } catch (error) {
    logger.error('Calendar token error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate calendar token' });
  }
});

/**
 * GET /api/calendar/preferences
 * Get calendar sync preferences for the authenticated user
 */
router.get('/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const preferences = await calendarService.getPreferences(req.user!.id);
    const tokenResponse = await calendarService.getToken(req.user!.id, getFeedBaseUrl(req));
    res.json({
      success: true,
      data: {
        ...preferences,
        feedUrl: tokenResponse.feedUrl,
      },
    });
  } catch (error) {
    logger.error('Calendar preferences fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch calendar preferences' });
  }
});

/**
 * PATCH /api/calendar/preferences
 * Update calendar sync preferences for the authenticated user
 */
router.patch('/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validated = validateRequest(calendarPreferencesSchema, req.body);
    const preferences = await calendarService.updatePreferences(req.user!.id, validated);
    const tokenResponse = await calendarService.getToken(req.user!.id, getFeedBaseUrl(req));

    res.json({
      success: true,
      data: {
        ...preferences,
        feedUrl: tokenResponse.feedUrl,
      },
      message: 'Calendar preferences updated successfully',
    });
  } catch (error) {
    logger.error('Calendar preferences update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update calendar preferences' });
  }
});

export { generateCalendarToken } from '../services/calendar-service';

export default router;
