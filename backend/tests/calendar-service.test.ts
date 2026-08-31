import {
  buildCalendarFeed,
  buildCancelledRenewalEvent,
  buildRenewalEvent,
  buildReminderEvent,
  generateCalendarToken,
  verifyCalendarToken,
  getSubscriptionEventUid,
  calendarService,
} from '../src/services/calendar-service';
import { supabase } from '../src/config/database';
import { userPreferenceService } from '../src/services/user-preference-service';
import type { Subscription } from '../src/types/reminder';

jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../src/services/user-preference-service', () => ({
  userPreferenceService: {
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
  },
}));

describe('CalendarService helpers', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    process.env.CALENDAR_SECRET = 'test-calendar-secret-key';
    jest.clearAllMocks();
  });

  it('generates deterministic tokens for the same user', () => {
    const tokenA = generateCalendarToken(userId);
    const tokenB = generateCalendarToken(userId);
    expect(tokenA).toBe(tokenB);
    expect(tokenA).toHaveLength(32);
  });

  it('verifies valid tokens and rejects invalid tokens', () => {
    const token = generateCalendarToken(userId);
    expect(verifyCalendarToken(userId, token)).toBe(true);
    expect(verifyCalendarToken(userId, 'invalid-token-value-here-123456')).toBe(false);
  });

  it('creates renewal events for active subscriptions', () => {
    const subscription: Subscription = {
      id: 'sub-1',
      user_id: userId,
      email_account_id: null,
      merchant_id: null,
      name: 'Netflix',
      provider: 'Netflix',
      category: 'entertainment',
      price: 15.99,
      billing_cycle: 'monthly',
      status: 'active',
      next_billing_date: '2026-06-01T00:00:00.000Z',
      logo_url: null,
      website_url: null,
      renewal_url: 'https://netflix.com/account',
      notes: null,
      tags: [],
      expired_at: null,
      active_until: null,
      is_trial: false,
      trial_ends_at: null,
      trial_converts_to_price: null,
      credit_card_required: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const event = buildRenewalEvent(subscription);
    expect(event.id).toBe(getSubscriptionEventUid('sub-1'));
    expect(event.summary).toContain('Netflix');
    expect(event.status).toBe('CONFIRMED');
  });

  it('creates cancelled events with stable UIDs for subscription updates', () => {
    const subscription: Subscription = {
      id: 'sub-2',
      user_id: userId,
      email_account_id: null,
      merchant_id: null,
      name: 'Spotify',
      provider: 'Spotify',
      category: 'entertainment',
      price: 9.99,
      billing_cycle: 'monthly',
      status: 'cancelled',
      next_billing_date: '2026-06-15T00:00:00.000Z',
      logo_url: null,
      website_url: null,
      renewal_url: null,
      notes: null,
      tags: [],
      expired_at: null,
      active_until: null,
      is_trial: false,
      trial_ends_at: null,
      trial_converts_to_price: null,
      credit_card_required: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
    };

    const event = buildCancelledRenewalEvent(subscription);
    expect(event.id).toBe(getSubscriptionEventUid('sub-2'));
    expect(event.status).toBe('CANCELLED');
  });

  it('builds an iCal feed with active, cancelled, and reminder events', () => {
    const activeSub = {
      id: 'sub-active',
      name: 'Adobe',
      price: 54.99,
      billing_cycle: 'monthly',
      next_billing_date: '2026-07-01T00:00:00.000Z',
      renewal_url: null,
    } as Subscription;

    const cancelledSub = {
      id: 'sub-cancelled',
      name: 'Dropbox',
      next_billing_date: '2026-07-10T00:00:00.000Z',
      updated_at: '2026-05-20T00:00:00.000Z',
    } as Subscription;

    const feed = buildCalendarFeed(
      [activeSub],
      [cancelledSub],
      [{
        id: 'rem-1',
        subscription_id: 'sub-active',
        reminder_date: '2026-06-24T00:00:00.000Z',
        reminder_type: 'renewal',
        days_before: 7,
        status: 'pending',
        subscriptions: { name: 'Adobe', price: 54.99, billing_cycle: 'monthly', status: 'active' },
      }],
    ).toString();

    expect(feed).toContain('BEGIN:VCALENDAR');
    expect(feed).toContain('Subscription Renewal: Adobe');
    expect(feed).toContain('Subscription Renewal: Dropbox');
    expect(feed).toContain('Renewal Reminder: Adobe');
    expect(feed).toContain('STATUS:CANCELLED');
    expect(feed).toContain(getSubscriptionEventUid('sub-active'));
    expect(feed).toContain(getSubscriptionEventUid('sub-cancelled'));
  });

  it('marks cancelled reminder schedules as cancelled events', () => {
    const event = buildReminderEvent({
      id: 'rem-cancelled',
      subscription_id: 'sub-1',
      reminder_date: '2026-06-01T00:00:00.000Z',
      reminder_type: 'renewal',
      days_before: 3,
      status: 'cancelled',
      subscriptions: { name: 'Hulu', price: 7.99, billing_cycle: 'monthly', status: 'cancelled' },
    });

    expect(event.status).toBe('CANCELLED');
  });
});

describe('CalendarService', () => {
  const userId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    process.env.CALENDAR_SECRET = 'test-calendar-secret-key';
    jest.clearAllMocks();
  });

  it('returns calendar preferences with defaults', async () => {
    (userPreferenceService.getPreferences as jest.Mock).mockResolvedValue({
      user_id: userId,
      calendar_sync_enabled: false,
      calendar_export_reminders: true,
    });

    const preferences = await calendarService.getPreferences(userId);
    expect(preferences.calendar_sync_enabled).toBe(false);
    expect(preferences.calendar_export_reminders).toBe(true);
  });

  it('generates feed URLs using the configured base URL', async () => {
    const tokenResponse = await calendarService.getToken(userId, 'https://app.syncro.test');
    expect(tokenResponse.feedUrl).toContain('https://app.syncro.test/api/calendar/feed/');
    expect(tokenResponse.feedUrl).toContain(`${userId}/`);
    expect(tokenResponse.feedUrl).toContain('.ics');
  });

  it('throws when calendar sync is disabled', async () => {
    (userPreferenceService.getPreferences as jest.Mock).mockResolvedValue({
      user_id: userId,
      calendar_sync_enabled: false,
      calendar_export_reminders: true,
    });

    await expect(calendarService.generateFeed(userId)).rejects.toThrow(
      'Calendar sync is disabled for this user',
    );
  });

  it('generates a feed with active and cancelled subscription events', async () => {
    (userPreferenceService.getPreferences as jest.Mock).mockResolvedValue({
      user_id: userId,
      calendar_sync_enabled: true,
      calendar_export_reminders: false,
    });

    const mockFrom = jest.fn((table: string) => {
      if (table === 'subscriptions') {
        const chain: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          then: undefined,
        };

        chain.eq = jest.fn().mockImplementation((_field: string, value: string) => {
          if (value === 'active') {
            return Promise.resolve({
              data: [{
                id: 'sub-active',
                name: 'Notion',
                price: 10,
                billing_cycle: 'monthly',
                next_billing_date: '2026-08-01T00:00:00.000Z',
                status: 'active',
              }],
              error: null,
            });
          }
          return chain;
        });

        chain.gte = jest.fn().mockResolvedValue({
          data: [{
            id: 'sub-cancelled',
            name: 'Canva',
            next_billing_date: '2026-08-05T00:00:00.000Z',
            updated_at: '2026-05-25T00:00:00.000Z',
            status: 'cancelled',
          }],
          error: null,
        });

        return chain;
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (supabase.from as jest.Mock).mockImplementation(mockFrom);

    const feed = await calendarService.generateFeed(userId);
    expect(feed).toContain('Subscription Renewal: Notion');
    expect(feed).toContain('Subscription Renewal: Canva');
    expect(feed).toContain('STATUS:CANCELLED');
  });
});
