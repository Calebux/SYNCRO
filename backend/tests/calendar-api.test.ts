import request from 'supertest';
import express from 'express';
import calendarRouter from '../src/routes/calendar';
import { calendarService, verifyCalendarToken } from '../src/services/calendar-service';

jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

jest.mock('../src/services/calendar-service', () => {
  const actual = jest.requireActual('../src/services/calendar-service');
  return {
    ...actual,
    calendarService: {
      generateFeed: jest.fn(),
      getToken: jest.fn(),
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
    },
    verifyCalendarToken: jest.fn(),
  };
});

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: '00000000-0000-0000-0000-000000000003', role: 'owner' };
    next();
  },
}));

const app = express();
app.use(express.json());
app.use('/api/calendar', calendarRouter);

describe('Calendar API', () => {
  const userId = '00000000-0000-0000-0000-000000000003';
  const token = 'valid-calendar-token-value-123456';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CALENDAR_SECRET = 'test-calendar-secret-key';
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  describe('GET /api/calendar/feed/:userId/:token.ics', () => {
    it('returns iCal content for a valid token', async () => {
      (verifyCalendarToken as jest.Mock).mockReturnValue(true);
      (calendarService.generateFeed as jest.Mock).mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');

      const response = await request(app).get(`/api/calendar/feed/${userId}/${token}.ics`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/calendar');
      expect(response.text).toContain('BEGIN:VCALENDAR');
      expect(calendarService.generateFeed).toHaveBeenCalledWith(userId);
    });

    it('returns 403 for an invalid token', async () => {
      (verifyCalendarToken as jest.Mock).mockReturnValue(false);

      const response = await request(app).get(`/api/calendar/feed/${userId}/bad-token.ics`);

      expect(response.status).toBe(403);
      expect(response.text).toBe('Invalid calendar token');
    });

    it('returns 403 when calendar sync is disabled', async () => {
      (verifyCalendarToken as jest.Mock).mockReturnValue(true);
      (calendarService.generateFeed as jest.Mock).mockRejectedValue(
        new Error('Calendar sync is disabled for this user'),
      );

      const response = await request(app).get(`/api/calendar/feed/${userId}/${token}.ics`);

      expect(response.status).toBe(403);
      expect(response.text).toBe('Calendar sync is disabled');
    });
  });

  describe('GET /api/calendar/token', () => {
    it('returns a feed token for authenticated users', async () => {
      (calendarService.getToken as jest.Mock).mockResolvedValue({
        token: 'abc123',
        userId,
        feedUrl: `http://localhost:3000/api/calendar/feed/${userId}/abc123.ics`,
      });

      const response = await request(app).get('/api/calendar/token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBe('abc123');
      expect(response.body.feedUrl).toContain('.ics');
    });
  });

  describe('GET /api/calendar/preferences', () => {
    it('returns calendar preferences and feed URL', async () => {
      (calendarService.getPreferences as jest.Mock).mockResolvedValue({
        calendar_sync_enabled: true,
        calendar_export_reminders: true,
      });
      (calendarService.getToken as jest.Mock).mockResolvedValue({
        token: 'abc123',
        userId,
        feedUrl: `http://localhost:3000/api/calendar/feed/${userId}/abc123.ics`,
      });

      const response = await request(app).get('/api/calendar/preferences');

      expect(response.status).toBe(200);
      expect(response.body.data.calendar_sync_enabled).toBe(true);
      expect(response.body.data.feedUrl).toContain('.ics');
    });
  });

  describe('PATCH /api/calendar/preferences', () => {
    it('updates calendar preferences', async () => {
      (calendarService.updatePreferences as jest.Mock).mockResolvedValue({
        calendar_sync_enabled: true,
        calendar_export_reminders: false,
      });
      (calendarService.getToken as jest.Mock).mockResolvedValue({
        token: 'abc123',
        userId,
        feedUrl: `http://localhost:3000/api/calendar/feed/${userId}/abc123.ics`,
      });

      const response = await request(app)
        .patch('/api/calendar/preferences')
        .send({ calendar_sync_enabled: true, calendar_export_reminders: false });

      expect(response.status).toBe(200);
      expect(response.body.data.calendar_export_reminders).toBe(false);
      expect(calendarService.updatePreferences).toHaveBeenCalledWith(userId, {
        calendar_sync_enabled: true,
        calendar_export_reminders: false,
      });
    });
  });
});
