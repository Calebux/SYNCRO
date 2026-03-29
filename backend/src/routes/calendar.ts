import { Router, Response, Request } from 'express';
import ical from 'ical-generator';
import { supabase } from '../config/database';
import crypto from 'crypto';
import logger from '../config/logger';

const router = Router();
const CALENDAR_SECRET = process.env.CALENDAR_SECRET || 'syncro-calendar-secret-key-123';

/**
 * Generate a secure token for a user
 */
export function generateCalendarToken(userId: string): string {
  return crypto
    .createHmac('sha256', CALENDAR_SECRET)
    .update(userId)
    .digest('hex')
    .substring(0, 16);
}

/**
 * GET /api/calendar/feed/:userId/:token.ics
 * Public endpoint for iCal feed (authenticated via token)
 */
router.get('/feed/:userId/:token.ics', async (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

    // Verify token
    const expectedToken = generateCalendarToken(userId);
    if (token !== expectedToken) {
      return res.status(403).send('Invalid calendar token');
    }

    // Fetch subscriptions for the user
    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      throw error;
    }

    const calendar = ical({ name: 'SYNCRO Subscriptions' });

    (subscriptions || []).forEach(sub => {
      if (sub.next_billing_date) {
        calendar.createEvent({
          start: new Date(sub.next_billing_date),
          allDay: true,
          summary: `Subscription Renewal: ${sub.name}`,
          description: `Renewal for ${sub.name} - $${sub.price}/${sub.billing_cycle}`,
          url: sub.renewal_url || undefined,
        });
      }
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="subscriptions.ics"');
    res.send(calendar.toString());
  } catch (error) {
    logger.error('Calendar feed error:', error);
    res.status(500).send('Internal server error');
  }
});

/**
 * GET /api/calendar/token
 * Get current user's calendar token (requires standard auth)
 */
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
router.get('/token', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const token = generateCalendarToken(req.user!.id);
  res.json({
    success: true,
    token,
    userId: req.user!.id,
  });
});

export default router;
